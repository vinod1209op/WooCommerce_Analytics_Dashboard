// apps/worker/src/analytics/scoring.js
import { prisma } from '../../../packages/database/index.js';

// turn value into 1..5 using quantiles
function scoreByQuantiles(arr, getter) {
  const vals = arr.map(getter).filter(v => Number.isFinite(v)).sort((a,b)=>a-b);
  if (!vals.length) return (/*v*/)=>3;
  const q = p => vals[Math.floor((vals.length-1)*p)];
  const q20=q(0.2), q40=q(0.4), q60=q(0.6), q80=q(0.8);
  return (v) => v <= q20 ? 1 : v <= q40 ? 2 : v <= q60 ? 3 : v <= q80 ? 4 : 5;
}

function segmentFromRFM(R, F, M, recencyDays) {
  if (recencyDays != null && recencyDays > 90) return 'Churn Risk';
  if (R >= 4 && F >= 4) return 'Champions';
  if (R >= 4 && M >= 4) return 'High Value';
  if (F >= 4)          return 'Loyal';
  if (R >= 3 && F >= 3) return 'Potential Loyalist';
  if (R <= 2 && F <= 2 && M <= 2) return 'At Risk';
  return 'Regular';
}

export async function recomputeCustomerScoresForStore(storeId) {
  // Pull per-customer metrics
  const orders = await prisma.order.findMany({
    where: { storeId },
    select: { customerId: true, total: true, created: true },
    orderBy: { created: 'asc' }
  });

  const byCustomer = new Map(); // id -> { totals[], created[] }
  for (const o of orders) {
    if (!o.customerId) continue;
    const it = byCustomer.get(o.customerId) || { totals: [], created: [] };
    it.totals.push(o.total || 0);
    it.created.push(o.created);
    byCustomer.set(o.customerId, it);
  }

  const today = new Date();
  const rows = [];
  for (const [customerId, it] of byCustomer.entries()) {
    const freq = it.created.length;
    const monetary = it.totals.reduce((s,x)=>s+(x||0),0);
    const last = it.created[it.created.length-1];
    const recencyDays = Math.round((today - last)/(1000*60*60*24));
    rows.push({ customerId, frequency: freq, monetary, lastOrder: last, recencyDays });
  }

  // Build quantile scorers (higher is better, so invert recency)
  const recencyScore = scoreByQuantiles(rows, r => -r.recencyDays);
  const freqScore    = scoreByQuantiles(rows, r => r.frequency);
  const monScore     = scoreByQuantiles(rows, r => r.monetary);

  // Write back
  for (const r of rows) {
    const R = recencyScore(r);
    const F = freqScore(r);
    const M = monScore(r);
    const segment = segmentFromRFM(R, F, M, r.recencyDays);

    await prisma.customerScore.upsert({
      where: { customerId: r.customerId },
      update: { lastOrder: r.lastOrder, frequency: r.frequency, monetary: r.monetary, lifetimeValue: r.monetary, recencyDays: r.recencyDays, RFM: R+F+M, segment },
      create: { customerId: r.customerId, storeId, lastOrder: r.lastOrder, frequency: r.frequency, monetary: r.monetary, lifetimeValue: r.monetary, recencyDays: r.recencyDays, RFM: R+F+M, segment },
    });
  }
}
