import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const SUMMARY_DB = process.env.NOTION_SUMMARY_DB_ID;
const PRODUCTS_DB = process.env.NOTION_PRODUCTS_DB_ID;

function toISODate(d) {
  const dt = new Date(d);
  return dt.toISOString().slice(0, 10);
}

// Create or update a daily summary row for a store+date
export async function upsertDailySummary({ storeName, date, endDate = null, revenue, orders, aov, units, customers }) {
    if (!SUMMARY_DB) return { ok: false, reason: 'No SUMMARY DB set' };

    const startDateStr = toISODate(date);
    const endDateStr = endDate ? toISODate(endDate) : null;

    // 🔍 Find if page already exists for this store + date (or range)
    const existing = await notion.databases.query({
       database_id: SUMMARY_DB,
       filter: {
          and: [
            { property: 'Store', title: { equals: storeName } },
            {
              property: 'Date',
              date: endDate
                ? { on_or_after: startDateStr, on_or_before: endDateStr }
                : { on_or_after: startDateStr, on_or_before: startDateStr }
            }
          ]
        },
        page_size: 1
    });

    const props = {
    Date: { date: endDate ? { start: startDateStr, end: endDateStr } : { start: startDateStr } },
    Store: { title: [{ text: { content: storeName } }] },
    Revenue: { number: Number(revenue || 0) },
    Orders: { number: Number(orders || 0) },
    AOV: { number: Number(aov || 0) },
    Units: { number: Number(units || 0) },
    Customers: { number: Number(customers || 0) }
  };

  if (existing.results.length) {
    const pageId = existing.results[0].id;
    await notion.pages.update({ page_id: pageId, properties: props });
    return { ok: true, action: 'updated', pageId };
  } else {
    const created = await notion.pages.create({
      parent: { database_id: SUMMARY_DB },
      properties: props
    });
    return { ok: true, action: 'created', pageId: created.id };
  }
}

export async function appendTopProducts({ storeName, date, products }) {
  if (!PRODUCTS_DB) return { ok: false, reason: 'No PRODUCTS DB set' };
  if (!products?.length) return { ok: true, action: 'no-products' };

  const dateStr = new Date(date).toISOString().slice(0, 10);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const num = (v) => Number(v || 0);
  const titleText = (s) => [{ text: { content: s } }];
  const richText = (s) => [{ text: { content: s } }];

  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const p of products) {
    const productName = p.name ?? `Product ${p.id}`;
    const sku = p.sku || 'N/A';
    const units = num(p.total_sales || p.units);
    const revenue = num(p.revenue ?? ((p.price || 0) * (p.total_sales || 0)));

    const key = `${storeName}|${dateStr}|${productName}|${sku}`;

    // Find existing by Key (fast + reliable)
    let existing;
    try {
      const res = await notion.databases.query({
        database_id: PRODUCTS_DB,
        filter: { property: 'Key', rich_text: { equals: key } },
        page_size: 2,
      });
      existing = res.results?.[0];
    } catch (e) {
      console.warn('Notion query failed:', e.message);
      errors++; continue;
    }

    const props = {
      Key: { rich_text: richText(key) },
      Date: { date: { start: dateStr } },
      Store: { rich_text: richText(storeName) },
      Product: { title: titleText(productName) },
      SKU: { rich_text: richText(sku) },
      Units: { number: units },
      Revenue: { number: revenue },
    };

    try {
      if (existing) {
        const ep = existing.properties || {};
        const same =
          (ep.Units?.number ?? 0) === units &&
          (ep.Revenue?.number ?? 0) === revenue;
        if (same) {
          skipped++;
        } else {
          await notion.pages.update({ page_id: existing.id, properties: props });
          updated++;
        }
      } else {
        await notion.pages.create({ parent: { database_id: PRODUCTS_DB }, properties: props });
        created++;
      }
    } catch (e) {
      console.warn('Notion upsert failed for', key, e.message);
      errors++;
    }

    await sleep(150); // be nice to rate limits
  }

  return { ok: errors === 0, created, updated, skipped, errors };
}