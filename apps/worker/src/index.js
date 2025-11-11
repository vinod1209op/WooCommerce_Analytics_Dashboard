import cron from 'node-cron';
import redis from 'redis';
import { prisma } from '../../../packages/database/index.js';
import WooCommerceClient from './woocommerce-client.js'; 
import { upsertDailySummary, appendTopProducts } from './integrations/notion.js';
import { recomputeCustomerScoresForStore } from './scoring.js';

const asStr = (v) => (v === null || v === undefined ? null : String(v));

async function findProductByWooOrSku(storeId, wooProductId, sku) {
  if (wooProductId) {
    const byWoo = await prisma.product.findFirst({
      where: { storeId, wooId: String(wooProductId) },
      select: { id: true },
    });
    if (byWoo) return byWoo;
  }
  if (sku) {
    const bySku = await prisma.product.findFirst({
      where: { storeId, sku },
      select: { id: true, /* wooId: true */ },
    });
    if (bySku) return bySku;
  }
  return null;
}
async function getProductIdByWoo(storeId, wooProductId, fallback) {
  const sku = fallback?.sku || null;
  const existing = await findProductByWooOrSku(storeId, wooProductId, sku);
  if (existing) return existing.id;

  // create placeholder if needed
  const created = await prisma.product.create({
    data: {
      storeId,
      wooId: wooProductId ? String(wooProductId) : null,
      name: fallback?.name || 'Unknown product',
      price: fallback?.price ?? 0,
      sku,
      categories: [],
    },
    select: { id: true },
  });
  return created.id;
}


async function upsertProductSmart(storeId, p) {
  const wooId = asStr(p.id);
  const sku = p.sku || null;
  const price = p.price ? parseFloat(p.price) || 0 : 0;
  const total_sales = p.total_sales ? parseInt(p.total_sales) || 0 : 0;
  const categories = (p.categories || []).map((c) => c.name);

  const existing = await findProductByWooOrSku(storeId, wooId, sku);

  if (existing) {
    // Update existing row (preserve id, attach wooId if missing)
    return prisma.product.update({
      where: { id: existing.id },
      data: {
        wooId,
        name: p.name ?? 'Unnamed',
        price,
        sku,               
        taxClass: p.tax_class || null,
        categories,
        productVariations: p.variations || [],
        total_sales,
      },
    });
  }

  // Create new row
  return prisma.product.create({
    data: {
      storeId,
      wooId,
      name: p.name ?? 'Unnamed',
      price,
      sku,
      taxClass: p.tax_class || null,
      categories,
      productVariations: p.variations || [],
      total_sales,
    },
  });
}

async function findCustomerByWooOrEmail(storeId, wooCustomerId, email) {
  if (wooCustomerId) {
    const byWoo = await prisma.customer.findFirst({
      where: { storeId, wooId: String(wooCustomerId) },
      select: { id: true },
    });
    if (byWoo) return byWoo;
  }
  if (email) {
    const byEmail = await prisma.customer.findFirst({
      where: { storeId, email },
      select: { id: true },
    });
    if (byEmail) return byEmail;
  }
  return null;
}

// ==== helpers/customers.js (or keep inline) ====

function normEmail(v) {
  if (!v || typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length ? e : null;
}

// merge loser -> winner and delete loser
async function mergeCustomers({ storeId, winnerId, loserId }) {
  if (!loserId || winnerId === loserId) return winnerId;

  await prisma.$transaction(async (tx) => {
    await tx.order.updateMany({ where: { storeId, customerId: loserId }, data: { customerId: winnerId } });
    await tx.subscription.updateMany({ where: { storeId, customerId: loserId }, data: { customerId: winnerId } });

    const loserScore = await tx.customerScore.findUnique({ where: { customerId: loserId } });
    if (loserScore) {
      const winnerScore = await tx.customerScore.findUnique({ where: { customerId: winnerId } });
      if (!winnerScore) {
        await tx.customerScore.create({
          data: { ...loserScore, customerId: winnerId, storeId, updatedAt: new Date() }
        });
      } else {
        await tx.customerScore.update({
          where: { customerId: winnerId },
          data: {
            lastOrder: (winnerScore.lastOrder && loserScore.lastOrder)
              ? (winnerScore.lastOrder > loserScore.lastOrder ? winnerScore.lastOrder : loserScore.lastOrder)
              : (winnerScore.lastOrder ?? loserScore.lastOrder),
            frequency: (winnerScore.frequency ?? 0) + (loserScore.frequency ?? 0),
            monetary: (winnerScore.monetary ?? 0) + (loserScore.monetary ?? 0),
            lifetimeValue: (winnerScore.lifetimeValue ?? 0) + (loserScore.lifetimeValue ?? 0),
            updatedAt: new Date(),
          }
        });
      }
      await tx.customerScore.delete({ where: { customerId: loserId } }).catch(() => {});
    }

    await tx.customer.delete({ where: { id: loserId } });
  });

  return winnerId;
}

// ensure there is at most one row for this (storeId,email), merging if needed
async function ensureSingleByEmail(storeId, email) {
  if (!email) return null;
  const rows = await prisma.customer.findMany({
    where: { storeId, email },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (rows.length <= 1) return rows[0]?.id || null;

  const winnerId = rows[0].id;
  for (let i = 1; i < rows.length; i++) {
    await mergeCustomers({ storeId, winnerId, loserId: rows[i].id });
  }
  return winnerId;
}

// MAIN ENTRY: always call this to resolve a customer id
export async function getCustomerIdByWoo(storeId, wooCustomerId, fallback) {
  const email = normEmail(fallback?.email);
  const wooId = wooCustomerId ? String(wooCustomerId) : null;

  // collapse duplicates by email first if needed
  const collapsedId = email ? await ensureSingleByEmail(storeId, email) : null;

  const byEmail = email
    ? await prisma.customer.findFirst({ where: { storeId, email }, select: { id: true, wooId: true } })
    : null;

  const byWoo = wooId
    ? await prisma.customer.findFirst({ where: { storeId, wooId }, select: { id: true, wooId: true, email: true } })
    : null;

  // both exist, different rows -> merge into the email row as winner
  if (byEmail && byWoo && byEmail.id !== byWoo.id) {
    const winnerId = await mergeCustomers({ storeId, winnerId: byEmail.id, loserId: byWoo.id });
    await prisma.customer.update({
      where: { id: winnerId },
      data: {
        wooId,
        first_name: fallback?.first_name ?? undefined,
        last_name:  fallback?.last_name  ?? undefined,
        username:   fallback?.username   ?? email ?? undefined,
        phone:      fallback?.phone      ?? undefined,
        billingAddressJson: fallback?.billing ?? undefined,
      }
    });
    return winnerId;
  }

  // prefer updating the email row if present
  if (byEmail && (!byWoo || byWoo.id === byEmail.id)) {
    const updated = await prisma.customer.update({
      where: { id: byEmail.id },
      data: {
        wooId: wooId ?? byEmail.wooId,
        first_name: fallback?.first_name ?? undefined,
        last_name:  fallback?.last_name  ?? undefined,
        username:   fallback?.username   ?? email ?? undefined,
        phone:      fallback?.phone      ?? undefined,
        billingAddressJson: fallback?.billing ?? undefined,
      },
      select: { id: true },
    });
    return updated.id;
  }

  // only woo row exists (no email row)
  if (byWoo && !byEmail) {
    try {
      const updated = await prisma.customer.update({
        where: { id: byWoo.id },
        data: {
          email: email ?? byWoo.email ?? `unknown+${Date.now()}@example.com`,
          first_name: fallback?.first_name ?? undefined,
          last_name:  fallback?.last_name  ?? undefined,
          username:   fallback?.username   ?? email ?? undefined,
          phone:      fallback?.phone      ?? undefined,
          billingAddressJson: fallback?.billing ?? undefined,
        },
        select: { id: true },
      });
      return updated.id;
    } catch (e) {
      // if setting email hit P2002 (someone else has it), merge into that owner
      if (e.code === 'P2002' && email) {
        const owner = await prisma.customer.findFirst({ where: { storeId, email }, select: { id: true } });
        if (owner) {
          const winnerId = await mergeCustomers({ storeId, winnerId: owner.id, loserId: byWoo.id });
          await prisma.customer.update({ where: { id: winnerId }, data: { wooId } });
          return winnerId;
        }
      }
      throw e;
    }
  }

  // neither exists -> create (guarded against race)
  try {
    const created = await prisma.customer.create({
      data: {
        storeId,
        wooId,
        email: email ?? `unknown+${Date.now()}@example.com`,
        first_name: fallback?.first_name ?? null,
        last_name:  fallback?.last_name  ?? null,
        username:   fallback?.username   ?? email ?? `user_${Date.now()}`,
        phone:      fallback?.phone      ?? null,
        billingAddressJson: fallback?.billing ?? null,
      },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    // if another concurrent worker already created the email row, just update that
    if (e.code === 'P2002' && email) {
      const owner = await prisma.customer.findFirst({ where: { storeId, email }, select: { id: true } });
      if (owner) {
        await prisma.customer.update({
          where: { id: owner.id },
          data: {
            wooId: wooId ?? undefined,
            first_name: fallback?.first_name ?? undefined,
            last_name:  fallback?.last_name  ?? undefined,
            username:   fallback?.username   ?? email ?? undefined,
            phone:      fallback?.phone      ?? undefined,
            billingAddressJson: fallback?.billing ?? undefined,
          },
        });
        return owner.id;
      }
    }
    throw e;
  }
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create clients
const redisClient = redis.createClient({ url: REDIS_URL });

redisClient.on('error', (err) => {
  console.log('Redis Client Error', err);
});

await redisClient.connect();
console.log('✅ Redis client connected');

// Worker functions with real WooCommerce integration
class AnalyticsWorker {
  constructor() {
    this.jobs = new Map();
  }

  async syncStoreData(store) {
    const jobId = `sync-${store.id}-${Date.now()}`;
    
    try {
      console.log(`🔄 Starting REAL data sync for store: ${store.name}`);
      
      // Log job start
      await prisma.jobRun.create({
        data: {
          type: 'data_sync',
          storeId: store.id,
          status: 'running',
          startedAt: new Date()
        }
      });

      // Test WooCommerce connection - no need to dynamic import anymore
      const wooCommerce = new WooCommerceClient(store);
      const connectionTest = await wooCommerce.testConnection();
      
      if (!connectionTest.success) {
        throw new Error(`WooCommerce connection failed: ${connectionTest.error}`);
      }

      console.log('✅ WooCommerce connection successful');

       // Sync orders (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      try { await this.syncProducts(wooCommerce, store); }
      catch (e) { console.warn('Products sync skipped:', e.message); }

      try { await this.syncOrders(wooCommerce, store, thirtyDaysAgo); }
      catch (e) { console.warn('Orders sync skipped:', e.message); }

      try { await this.syncCustomers(wooCommerce, store); }
      catch (e) { console.warn('Customers sync skipped:', e.message); }

      try { await this.syncSubscriptions(wooCommerce, store); }
      catch (e) { console.warn('Subscriptions sync skipped:', e.message); }

      try { await recomputeCustomerScoresForStore(store.id); }
      catch (e) { console.warn('RFM recompute skipped:', e.message); }


      // Update job status
      await prisma.jobRun.updateMany({
        where: {
          storeId: store.id,
          type: 'data_sync',
          status: 'running'
        },
        data: {
          status: 'completed',
          endedAt: new Date(),
          durationMs: 1000
        }
      });
      
      await redisClient.set(
        `job:${jobId}`, 
        JSON.stringify({
          status: 'completed',
          storeId: store.id,
          timestamp: new Date().toISOString()
        })
      );
      
      console.log(`✅ Completed REAL data sync for store: ${store.name}`);
      
    } catch (error) {
      console.error(`❌ Error syncing REAL data for ${store.name}:`, error);
      
      // Update job status to failed
      await prisma.jobRun.updateMany({
        where: {
          storeId: store.id,
          type: 'data_sync',
          status: 'running'
        },
        data: {
          status: 'failed',
          endedAt: new Date(),
          notes: error.message
        }
      });

      await redisClient.set(
        `job:${jobId}`, 
        JSON.stringify({
          status: 'failed',
          storeId: store.id,
          error: error.message,
          timestamp: new Date().toISOString()
        })
      );
    }

    try {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 30);

      // Compute KPIs via Prisma (re-using your DB):
      const [agg, itemsAgg, uniqueCus] = await Promise.all([
        prisma.order.aggregate({
          _count: { _all: true },
          _sum: { total: true },
          where: { storeId: store.id, created: { gte: start, lt: end } },
        }),
        prisma.orderItem.aggregate({
          _sum: { quantity: true },
          where: { order: { storeId: store.id, created: { gte: start, lt: end } } },
        }),
        prisma.order.findMany({
          where: { storeId: store.id, created: { gte: start, lt: end } },
          select: { customerId: true },
        }),
      ]);

      const orders = agg._count._all || 0;
      const revenue = agg._sum.total || 0;
      const units = itemsAgg._sum.quantity || 0;
      const uniqueCustomers = new Set(uniqueCus.map(x => x.customerId).filter(Boolean)).size;
      const aov = orders ? revenue / orders : 0;

      await upsertDailySummary({
        storeName: store.name,
        date: new Date('2025-10-10'),
        endDate: end,
        revenue, orders, aov, units, customers: uniqueCustomers,
      });

      const seven = new Date(); seven.setDate(seven.getDate() - 7);
      const topGroup = await prisma.orderItem.groupBy({
        by: ['productId'],
        _sum: { quantity: true, total: true },
        where: { order: { storeId: store.id, created: { gte: seven, lt: end } } },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      });
      const productIds = topGroup.map(g => g.productId).filter(Boolean);
      const productMap = Object.fromEntries(
        (await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true, price: true, total_sales: true } }))
          .map(p => [p.id, p])
      );
      const topProducts = topGroup.map(g => {
        const p = productMap[g.productId] || {};
        return {
          id: g.productId,
          name: p.name,
          sku: p.sku,
          price: p.price,
          total_sales: g._sum.quantity || p.total_sales || 0,
          revenue: g._sum.total ?? (p.price || 0) * (p.total_sales || 0),
        };
      });

      await appendTopProducts({
        storeName: store.name,
        date: end,
        products: topProducts,
      });

      console.log('✅ Notion sync done');
    } catch (e) {
      console.log('⚠️ Notion sync skipped/failed:', e.message);
    }

  }

  async syncProducts(wooCommerce, store) {
  console.log('📦 Syncing products from WooCommerce...');
  const result = await wooCommerce.getProducts();
  if (!result.success) throw new Error(`Failed to fetch products: ${result.error}`);

  let ok = 0, fail = 0;
  for (const p of result.data) {
    try {
      await upsertProductSmart(store.id, p);
      ok++;
    } catch (e) {
      console.log(`❌ Product ${p.id} (${p.name}): ${e.message}`);
      fail++;
    }
  }
  console.log(`✅ Synced ${ok} products, ${fail} failed`);
  }

  async syncOrders(wooCommerce, store, afterDate) {
  console.log('📋 Syncing orders from WooCommerce...');
  const result = await wooCommerce.getOrders({
    per_page: 100,
    orderby: 'date',
    order: 'asc',
    after: afterDate?.toISOString(),
  });
  if (!result.success) throw new Error(`Failed to fetch orders: ${result.error}`);

  let count = 0;
  for (const o of result.data) {
    // resolve customerId in our DB
    const customerId = await getCustomerIdByWoo(
      store.id,
      o.customer_id,
      {
        email: o.billing?.email,
        first_name: o.billing?.first_name,
        last_name: o.billing?.last_name,
        username: o.billing?.email,
        phone: o.billing?.phone,
        billing: o.billing,
      }
    );

    const shippingCost = (o.shipping_lines || []).reduce((s, l) => s + (parseFloat(l.total || '0') || 0), 0);
    const discountTotal = parseFloat(o.discount_total ?? '0') || null;
    const tax = parseFloat(o.total_tax ?? '0') || null;
    const total = parseFloat(o.total ?? '0') || 0;

    // upsert order by (storeId, wooId)
    const order = await prisma.order.upsert({
      where: { storeId_wooId: { storeId: store.id, wooId: String(o.id) } },
      update: {
        created: new Date(o.date_created_gmt || o.date_created),
        total,
        subtotal: null,            // optionally compute from line_items
        tax,
        shippingCost,
        discount: discountTotal,
        discountTotal,
        currency: o.currency || null,
        status: o.status || null,
        customerId,
      },
      create: {
        storeId: store.id,
        wooId: String(o.id),
        created: new Date(o.date_created_gmt || o.date_created),
        total,
        subtotal: null,
        tax,
        shippingCost,
        discount: discountTotal,
        discountTotal,
        currency: o.currency || null,
        status: o.status || null,
        customerId,
      },
      select: { id: true },
    });

    function pickUTM(meta = []) {
      const map = {};
      for (const m of meta) {
        const k = (m.key || '').toLowerCase();
        const v = (m.value ?? '').toString();
        if (!v) continue;
        if (k.includes('utm_source'))   map.utmSource = v;
        if (k.includes('utm_medium'))   map.utmMedium = v;
        if (k.includes('utm_campaign')) map.utmCampaign = v;
        if (k.includes('utm_term'))     map.utmTerm = v;
        if (k.includes('utm_content'))  map.utmContent = v;
      }
      return map;
    }

    const utm = pickUTM(o.meta_data || []);
    if (Object.keys(utm).length) {
      await prisma.orderAttribution.upsert({
        where: { orderId: order.id },
        update: utm,
        create: { orderId: order.id, ...utm },
      });
    }


    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });

    for (const cl of (o.coupon_lines || [])) {
      await this.upsertCoupon(store.id, { 
        code: cl.code, 
        discount_type: cl.discount_type, 
        amount: cl.amount, 
        date_expires: cl.date_expires, 
        usage_limit: cl.usage_limit 
      });

      // adapt to your schema types:
      await prisma.orderCoupon.create({
        data: {
          order:  { connect: { id: order.id } },
          coupon: { connect: { storeId_code: { storeId: store.id, code: cl.code } } },
          discountApplied: Number(cl.discount ?? 0),
          totalRevenueImpact: Number(cl.discount ?? 0), // ✅ correct spelling
        },
      });
    }

    for (const li of (o.line_items || [])) {
      const productId = await getProductIdByWoo(
        store.id,
        li.product_id,
        {
          name: li.name,
          price: parseFloat(li.price ?? li.total ?? '0') || 0,
          sku: li.sku,
        }
      );

      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: productId ?? undefined,  
          productSku: li.sku || null,
          name: li.name || 'Item',
          quantity: li.quantity ?? 1,
          total: parseFloat(li.total ?? '0') || 0,
          total_tax: parseFloat(li.total_tax ?? '0') || 0,
        },
      });
    }

    // ShippingDetails 1:1
    const addr = o.shipping || null;
    const method = (o.shipping_lines?.[0]?.method_title) || null;
    await prisma.shippingDetails.upsert({
      where: { orderId: order.id },
      update: {
        method,
        cost: shippingCost || null,
        addressJson: addr || null,
        country: addr?.country || null,
        state: addr?.state || null,
        city: addr?.city || null,
        postalCode: addr?.postcode || null,
      },
      create: {
        orderId: order.id,
        method,
        cost: shippingCost || null,
        addressJson: addr || null,
        country: addr?.country || null,
        state: addr?.state || null,
        city: addr?.city || null,
        postalCode: addr?.postcode || null,
      },
    });

    count++;
  }
  async function reconcileDay(woo, store, day) {
    const start = new Date(day); start.setHours(0,0,0,0);
    const end = new Date(start); end.setDate(end.getDate()+1);

    const wooRes = await woo.getOrders({ after: start.toISOString(), before: end.toISOString(), per_page: 100, order: 'asc' });
    const wooOrders = Array.isArray(wooRes.data) ? wooRes.data.length : 0;
    const wooRevenue = Array.isArray(wooRes.data) ? wooRes.data.reduce((s,o)=>s+(parseFloat(o.total||'0')||0), 0) : 0;

    const dbOrders = await prisma.order.findMany({ where: { storeId: store.id, created: { gte: start, lt: end }}, select: { total: true }});
    const dbRevenue = dbOrders.reduce((s,o)=>s+(o.total||0),0);

    await prisma.reconciliation.upsert({
      where: { storeId_date: { storeId: store.id, date: start } }, // add a @@unique([storeId, date]) if you want
      update: { wooOrders, wooRevenue, dbOrders: dbOrders.length, diffRevenue: wooRevenue - dbRevenue, status: Math.abs(wooRevenue-dbRevenue) < 0.01 ? 'ok' : 'mismatch' },
      create: { storeId: store.id, date: start, wooOrders, wooRevenue, dbOrders: dbOrders.length, diffRevenue: wooRevenue - dbRevenue, status: Math.abs(wooRevenue-dbRevenue) < 0.01 ? 'ok' : 'mismatch' },
    });
  }


  console.log(`✅ Synced ${count} orders`);
  }

  async syncCustomers(wooCommerce, store) {
    console.log('👥 Syncing customers from WooCommerce...');
    const result = await wooCommerce.getCustomers();
    if (!result.success) {
      console.warn('⚠️ Could not fetch customers:', result.error);
      console.warn('↪️ Fallback: deriving customers from recent orders...');
      const since = new Date(); since.setDate(since.getDate() - 90);
      const orders = await wooCommerce.getOrders({ after: since.toISOString(), order: 'asc' });
      if (!orders.success) { console.warn('⚠️ Fallback also failed:', orders.error); return; }

      const seen = new Set();
      for (const o of orders.data) {
        const email = o?.billing?.email?.toLowerCase?.()?.trim?.();
        if (!email) continue;
        const key = `${store.id}|${email}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await getCustomerIdByWoo(store.id, o.customer_id, {
          email,
          first_name: o.billing?.first_name,
          last_name:  o.billing?.last_name,
          username:   o.billing?.email || email,
          phone:      o.billing?.phone,
          billing:    o.billing,
        });
      }
      console.log(`✅ Fallback created/updated ~${seen.size} customers from orders.`);
      return;
    }

    let ok = 0, fail = 0;
    for (const c of result.data) {
      try {
        await getCustomerIdByWoo(store.id, c.id, {
          email: c.email,
          first_name: c.first_name,
          last_name: c.last_name,
          username: c.username,
          phone: c.billing?.phone,
          billing: c.billing,
        });
        ok++;
      } catch (e) {
        console.log(`❌ Customer ${c.id} (${c.email || c.username}): ${e.message}`);
        fail++;
      }
    }
    console.log(`✅ Synced ${ok} customers, ${fail} failed`);
  }


  async upsertCoupon(storeId, c) {
    await prisma.coupon.upsert({
      where: { storeId_code: { storeId, code: c.code } },
      update: {
        discountType: c.discount_type || null,
        discount: parseFloat(c.amount ?? '0') || 0,
        dateExpires: c.date_expires ? new Date(c.date_expires) : null,
        usageLimit: c.usage_limit ?? null,
      },
      create: {
        storeId,
        code: c.code,
        discountType: c.discount_type || null,
        discount: parseFloat(c.amount ?? '0') || 0,
        dateExpires: c.date_expires ? new Date(c.date_expires) : null,
        usageLimit: c.usage_limit ?? null,
      },
    });
  }


  async syncCoupons(woo, store) {
    const res = await woo.getCoupons?.();
    if (!res?.success) return;
    for (const c of res.data) await this.upsertCoupon(store.id, c);
  }

  async syncSubscriptions(woo, store) {
    console.log('🔁 Syncing subscriptions from WooCommerce...');
    const res = await woo.getSubscriptions({ per_page: 50, order: 'desc' });
    if (!res.success) {
      console.log('ℹ️ Subscriptions endpoint not available:', res.error);
      return;
    }

    let ok = 0, fail = 0;
    for (const s of res.data) {
      try {
        const startedAt = new Date(
          s.date_created_gmt || s.date_created || s.start_date_gmt || s.start_date || Date.now()
        );
        const nextRaw = s.next_payment_date_gmt || s.next_payment || s.schedule?.next_payment;
        const nextPayment = nextRaw ? new Date(nextRaw) : null;
        const interval = `${s.billing_interval ?? '1'} ${s.billing_period ?? 'month'}`;
        let recurringRevenue = null;
        if (s.total) recurringRevenue = parseFloat(s.total) || null;
        if (!recurringRevenue && s.billing_amount) recurringRevenue = parseFloat(s.billing_amount) || null;

        const customerId = await getCustomerIdByWoo(
          store.id,
          s.customer_id || s.customer || s.user_id,
          {
            email: s.billing?.email,
            first_name: s.billing?.first_name,
            last_name: s.billing?.last_name,
            username: s.billing?.email,
            phone: s.billing?.phone,
            billing: s.billing,
          }
        );

        let productId = null;
        const li = Array.isArray(s.line_items) && s.line_items.length ? s.line_items[0] : null;
        if (li) {
          productId = await getProductIdByWoo(
            store.id,
            li.product_id || li.variation_id,
            { name: li.name, price: parseFloat(li.total ?? li.price ?? '0') || 0, sku: li.sku || null }
          );
        } else {
          productId = await getProductIdByWoo(store.id, null, { name: 'Subscription', price: 0, sku: null });
        }

        const wooSubId = String(s.id);
        await prisma.subscription.upsert({
          where: { storeId_wooId: { storeId: store.id, wooId: wooSubId } },
          update: { status: s.status || 'active', interval, startedAt, nextPayment, recurringRevenue, customerId, productId },
          create: { storeId: store.id, wooId: wooSubId, status: s.status || 'active', interval, startedAt, nextPayment, recurringRevenue, customerId, productId },
        });

        ok++;
      } catch (e) {
        console.log(`❌ Subscription ${s?.id ?? '?'}: ${e.message}`);
        fail++;
      }
    }
    console.log(`✅ Subscriptions synced: ${ok} ok, ${fail} failed`);
  }
}

// Initialize worker
const worker = new AnalyticsWorker();

// Test connection on startup
async function testWooCommerceConnection() {
  try {
    console.log('🔍 Starting WooCommerce connection test...');
    
    const stores = await prisma.store.findMany();
    console.log(`📋 Found ${stores.length} stores in database`);
    
    if (stores.length === 0) {
      console.log('⚠️ No stores found in database');
      return;
    }

    for (const store of stores) {
      console.log(`🔄 Testing connection for store: ${store.name}`);
      console.log(`   URL: ${store.wooBaseUrl}`);
      console.log(`   Key: ${store.wooKey ? `${store.wooKey.substring(0, 10)}...` : 'MISSING'}`);
      
      const wooCommerce = new WooCommerceClient(store);
      const test = await wooCommerce.testConnection();
      
      if (test.success) {
        console.log(`✅ WooCommerce connection successful for: ${store.name}`);
        // Sync data immediately on startup
        await worker.syncStoreData(store);
      } else {
        console.log(`❌ WooCommerce connection failed for: ${store.name}`);
        console.log(`   Error: ${test.error}`);
      }
    }
  } catch (error) {
    console.log('⚠️ Could not test WooCommerce connection on startup:', error.message);
    console.log('Stack trace:', error.stack);
  }
}

// Scheduled jobs - every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('⏰ Running scheduled data sync...');
  
  try {
    const stores = await prisma.store.findMany();
    for (const store of stores) {
      await worker.syncStoreData(store);
    }
  } catch (error) {
    console.error('❌ Error in scheduled job:', error);
  }
});

console.log('👷 Worker service started');
console.log('⏰ Scheduled jobs: Data sync every 15 minutes');

// Test connection on startup
testWooCommerceConnection();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down worker...');
  await redisClient.quit();
  await prisma.$disconnect();
  process.exit(0);
});