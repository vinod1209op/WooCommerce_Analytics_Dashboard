import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { prisma } from '../../../packages/database/index.js';

import WooCommerceClient from './woocommerce-client.js';

import webhookRouter from './webhooks.js';

import { upsertDailySummary } from '../../worker/src/integrations/notion.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));

app.use('/api', webhookRouter);

function asDate(v) {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(+d) ? undefined : d;
}

function deriveSegment({ recencyDays, frequency, monetary }) {
  // recency score (lower days = better)
  const r =
    recencyDays == null ? 3 :
    recencyDays <= 30 ? 5 :
    recencyDays <= 60 ? 4 :
    recencyDays <= 120 ? 3 :
    recencyDays <= 240 ? 2 : 1;

  // frequency score
  const f =
    frequency == null ? 2 :
    frequency >= 10 ? 5 :
    frequency >= 5 ? 4 :
    frequency >= 3 ? 3 :
    frequency >= 2 ? 2 : 1;

  // monetary score
  const m =
    monetary == null ? 2 :
    monetary >= 1000 ? 5 :
    monetary >= 500 ? 4 :
    monetary >= 200 ? 3 :
    monetary >= 50 ? 2 : 1;

  // Simple rule-set → label
  if (r >= 4 && f >= 4 && m >= 4) return 'Champions';
  if (r >= 4 && f >= 3) return 'Loyal';
  if (r >= 3 && m >= 4) return 'Big Spenders';
  if (r <= 2 && f >= 3) return 'At Risk';
  if (r <= 2 && f <= 2) return 'Hibernating';
  return 'Potential Loyalist';
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: 'connected',
      service: 'WooCommerce Analytics API',
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      database: 'disconnected',
      error: error.message,
    });
  }
});

// WooCommerce test endpoint
app.get('/api/woocommerce/test', async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId is required' });

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const woo = new WooCommerceClient(store);
    const test = await woo.testConnection();

    res.json(test);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Store management endpoints
app.get('/api/stores', async (_req, res) => {
  try {
    const stores = await prisma.store.findMany({
      select: { id: true, name: true, wooBaseUrl: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(stores);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stores Endpoint
app.post('/api/stores', async (req, res) => {
  try {
    const { name, wooBaseUrl, wooKey, wooSecret, webhookSecret } = req.body;
    if (!name || !wooBaseUrl || !wooKey || !wooSecret) {
      return res.status(400).json({ error: 'name, wooBaseUrl, wooKey, wooSecret are required' });
    }
    const store = await prisma.store.create({
      data: { name, wooBaseUrl, wooKey, wooSecret, webhookSecret: webhookSecret ?? null },
    });
    res.json(store);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// KPIs endpoint
app.get('/api/kpis', async (req, res) => {
  try {
    const { storeId, start, end } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId is required' });

    const startDate = start ? new Date(start) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = end ? new Date(end) : new Date();
    if (Number.isNaN(+startDate) || Number.isNaN(+endDate)) {
      return res.status(400).json({ error: 'Invalid start or end date' });
    }
    endDate.setHours(23, 59, 59, 999);

    const agg = await prisma.order.aggregate({
      _count: { _all: true },
      _sum: { total: true, discountTotal: true, tax: true, shippingCost: true },
      where: { storeId, created: { gte: startDate, lte: endDate } },
    });

    const orders = agg._count._all || 0;
    const revenue = agg._sum.total || 0;
    const aov = orders ? revenue / orders : 0;

    // units sold 
    const itemsAgg = await prisma.orderItem.aggregate({
      _sum: { quantity: true },
      where: { order: { storeId, created: { gte: startDate, lte: endDate } } },
    });

    // unique customers
    const customers = await prisma.order.findMany({
      where: { storeId, created: { gte: startDate, lte: endDate } },
      select: { customerId: true },
    });
    const uniqueCustomers = new Set(customers.map(c => c.customerId).filter(Boolean)).size;

    res.json({
      revenue: Math.round(revenue * 100) / 100,
      orders,
      aov: Math.round(aov * 100) / 100,
      units: itemsAgg._sum.quantity || 0,
      uniqueCustomers,
    });
  } catch (error) {
    console.error('KPI error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Popular products
app.get('/api/products/popular', async (req, res) => {
  try {
    const { storeId, limit = 10 } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId is required' });

    const items = await prisma.product.findMany({
      where: { storeId },
      orderBy: { total_sales: 'desc' },
      take: Math.min(parseInt(limit, 10) || 10, 100),
      select: { id: true, name: true, price: true, total_sales: true, sku: true },
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Timeseries for charts
app.get('/api/sales', async (req, res) => {
  try {
    const { storeId, start, end } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId is required' });

    const startDate = start ? new Date(start) : new Date(Date.now() - 30 * 864e5);
    const endDate = end ? new Date(end) : new Date();
    if (Number.isNaN(+startDate) || Number.isNaN(+endDate)) {
      return res.status(400).json({ error: 'Invalid start or end date' });
    }

    const rows = await prisma.$queryRawUnsafe(`
      select date_trunc('day', "created") as day,
             sum("total") as revenue,
             count(*) as orders
      from "orders"
      where "storeId" = $1 and "created" >= $2 and "created" < $3
      group by 1
      order by 1 asc
    `, storeId, startDate, endDate);

    res.json(rows.map(r => ({
      date: new Date(r.day).toISOString().slice(0,10),
      revenue: Number(r.revenue || 0),
      orders: Number(r.orders || 0),
    })));
  } catch (e) {
    console.error('sales error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Distinct categories for a store
app.get('/api/meta/categories', async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });

    // Product.categories is String[]
    const products = await prisma.product.findMany({
      where: { storeId },
      select: { categories: true },
    });

    const set = new Set();
    for (const p of products) (p.categories || []).forEach(c => c && set.add(c));
    res.json(Array.from(set).sort());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analytics/segments/summary', async (req, res) => {
  try {
    const { storeId } = req.query;
    const start = asDate(req.query.start);
    const end = asDate(req.query.end);

    if (!storeId) return res.status(400).json({ error: 'storeId is required' });

    // 1) Revenue + order count per customer in the window
    const ordersAgg = await prisma.order.groupBy({
      by: ['customerId'],
      where: {
        storeId,
        created: {
          gte: start ?? undefined,
          lte: end ?? undefined,
        },
      },
      _sum: { total: true },
      _count: { _all: true },
    });

    const customerIds = ordersAgg
      .map(o => o.customerId)
      .filter((id) => id !== null);

    if (customerIds.length === 0) {
      return res.json([]);
    }

    // 2) Pull CustomerScore for those customers
    const scores = await prisma.customerScore.findMany({
      where: { storeId, customerId: { in: customerIds } },
      select: {
        customerId: true,
        segment: true,
        recencyDays: true,
        frequency: true,
        monetary: true,
      },
    });

    // Map customerId -> segment
    const segByCustomer = new Map();
    for (const s of scores) {
      const label = s.segment?.trim() || deriveSegment(s);
      segByCustomer.set(s.customerId, label);
    }

    // 3) Aggregate by segment
    const bySegment = new Map();
    for (const row of ordersAgg) {
      const cid = row.customerId;
      if (cid == null) continue;

      const seg = segByCustomer.get(cid) || 'Unsegmented';
      if (!bySegment.has(seg)) {
        bySegment.set(seg, { customers: new Set(), revenue: 0, orders: 0 });
      }
      const bucket = bySegment.get(seg);
      bucket.customers.add(cid);
      bucket.revenue += Number(row._sum.total || 0);
      bucket.orders += Number(row._count._all || 0);
    }

    // 4) Shape result
    const result = Array.from(bySegment.entries()).map(([segment, v]) => {
      const customers = v.customers.size;
      const revenue = Math.round(v.revenue * 100) / 100;
      const avgValue = customers ? Math.round((revenue / customers) * 100) / 100 : 0;
      return { segment, customers, revenue, avgValue };
    });

    // sort by revenue desc for nicer charts
    result.sort((a, b) => b.revenue - a.revenue);

    res.json(result);
  } catch (e) {
    console.error('segments/summary error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analytics/rfm/heatmap', async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId is required' });

    // Pull all scores for store
    const rows = await prisma.customerScore.findMany({
      where: { storeId },
      select: { recencyDays: true, frequency: true },
    });

    // Score functions
    const recencyScore = (days) => (
      days == null ? 3 :
      days <= 30 ? 5 :
      days <= 60 ? 4 :
      days <= 120 ? 3 :
      days <= 240 ? 2 : 1
    );
    const frequencyScore = (freq) => (
      freq == null ? 2 :
      freq >= 10 ? 5 :
      freq >= 5 ? 4 :
      freq >= 3 ? 3 :
      freq >= 2 ? 2 : 1
    );

    // Build 5x5 counts
    const grid = new Map();
    for (const r of rows) {
      const rs = recencyScore(r.recencyDays);
      const fs = frequencyScore(r.frequency);
      const key = `${rs}-${fs}`;
      grid.set(key, (grid.get(key) || 0) + 1);
    }

    // Normalize counts to 1..5 for a simple heat "score"
    const counts = Array.from(grid.values());
    const max = counts.length ? Math.max(...counts) : 1;

    const out = [];
    for (let r = 1; r <= 5; r++) {
      for (let f = 1; f <= 5; f++) {
        const count = grid.get(`${r}-${f}`) || 0;
        const score = max ? Math.min(5, Math.round((count / max) * 5)) : 0;
        out.push({ recency: r, frequency: f, count, score });
      }
    }

    res.json(out);
  } catch (e) {
    console.error('rfm/heatmap error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Distinct coupons for a store
app.get('/api/meta/coupons', async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });

    const coupons = await prisma.coupon.findMany({
      where: { storeId },
      select: { code: true },
      orderBy: { code: 'asc' },
    });
    res.json(coupons.map(c => c.code));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Notion Endpoint
app.post('/api/notion/sync', async (req, res) => {
  try {
    const { storeId } = req.body;
    if (!storeId) return res.status(400).json({ error: 'storeId required' });

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const end = new Date();
    const start = new Date(); start.setDate(end.getDate() - 1);

    const agg = await prisma.order.aggregate({
      _count: { _all: true },
      _sum: { total: true },
      where: { storeId, created: { gte: start, lt: end } },
    });
    const items = await prisma.orderItem.aggregate({
      _sum: { quantity: true },
      where: { order: { storeId, created: { gte: start, lt: end } } },
    });
    const customers = await prisma.order.findMany({
      where: { storeId, created: { gte: start, lt: end } },
      select: { customerId: true },
    });

    const orders = agg._count._all || 0;
    const revenue = agg._sum.total || 0;
    const units = items._sum.quantity || 0;
    const uniqueCustomers = new Set(customers.map(c => c.customerId).filter(Boolean)).size;
    const aov = orders ? revenue / orders : 0;

    const resp = await upsertDailySummary({
      storeName: store.name, date: end, revenue, orders, aov, units, customers: uniqueCustomers,
    });
    res.json(resp);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err?.stack || err?.message || err);
  res.status(500).json({ error: err?.message || 'Internal Server Error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});