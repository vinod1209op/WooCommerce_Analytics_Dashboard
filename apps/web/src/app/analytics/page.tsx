'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';
import { useHasMounted } from '@/hooks/useHasMounted';
import DarkToggle from '@/components/DarkToggle';
import { FilterBar, FilterState } from '@/components/FilterBar';

interface SalesData { date: string; revenue: number; orders: number; }
interface RawSalesPoint { date?: string; day?: string; revenue?: number | string; orders?: number | string }
interface RfmCell { recency: number; frequency: number; count: number; score: number }
interface RfmPoint { bucket: string; count: number }
interface SegmentPoint { segment: string; customers: number }

const API = process.env.NEXT_PUBLIC_API_BASE!;
const STORE_ID = process.env.NEXT_PUBLIC_STORE_ID!;

const pad = 'p-5 md:p-6';
const card = 'rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 shadow-sm';
const sectionTitle = 'text-xl font-semibold text-gray-800 dark:text-gray-100';
const toISO = (d: Date) => new Date(d).toISOString();
const ymd = (s: string | Date) => {
  const d = new Date(s); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
};
const fmtMoney = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function AnalyticsPage() {
  const hasMounted = useHasMounted();

  // filters
  const [filter, setFilter] = useState<FilterState>(() => {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - 30);
    return { type: 'date', date: { from, to } };
  });
  const [categories, setCategories] = useState<string[]>([]);
  const [coupons, setCoupons] = useState<string[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);

  const { start, end } = useMemo(() => {
    const to = filter.date?.to ?? new Date();
    const from = filter.date?.from ?? new Date(new Date().setDate(to.getDate() - 30));
    return { start: from, end: to };
  }, [filter.date?.from, filter.date?.to]);

  // data state
  const [loading, setLoading] = useState(true);
  const [salesData, setSalesData] = useState<SalesData[]>([]);
  const [rfmData, setRfmData] = useState<RfmPoint[]>([]);
  const [segmentData, setSegmentData] = useState<SegmentPoint[]>([]);

  // load meta once
  useEffect(() => {
    if (!hasMounted) return;
    let alive = true;
    (async () => {
      try {
        setLoadingMeta(true);
        const [catsRes, coupsRes] = await Promise.all([
          fetch(`${API}/api/meta/categories?storeId=${encodeURIComponent(STORE_ID)}`),
          fetch(`${API}/api/meta/coupons?storeId=${encodeURIComponent(STORE_ID)}`),
        ]);
        const [cats, coups] = await Promise.all([catsRes.json(), coupsRes.json()]);
        if (!alive) return;
        setCategories(Array.isArray(cats) ? cats.filter((x): x is string => typeof x === 'string') : []);
        setCoupons(Array.isArray(coups) ? coups.filter((x): x is string => typeof x === 'string') : []);
      } finally {
        if (alive) setLoadingMeta(false);
      }
    })();
    return () => { alive = false; };
  }, [hasMounted]);

  // fetch chart data
  useEffect(() => {
    if (!hasMounted) return;
    (async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          storeId: STORE_ID,
          start: toISO(start),
          end: toISO(end),
        });
        if (filter.type === 'category' && filter.category) params.set('category', filter.category);
        if (filter.type === 'coupon' && filter.coupon) params.set('coupon', filter.coupon);

        // Sales (Revenue + Orders)
        const salesUrl = `${API}/api/sales?${params.toString()}`;
        const salesRes = await fetch(salesUrl);
        const raw = (await salesRes.json()) as unknown;
        const arr: RawSalesPoint[] = Array.isArray(raw) ? raw : [];
        const series: SalesData[] = arr.map((r) => ({
          date: r.date ? ymd(r.date) : (r.day ? ymd(r.day) : ymd(new Date())),
          revenue: Number(r.revenue ?? 0),
          orders: Number(r.orders ?? 0),
        }));
        setSalesData(series);

        // RFM
        const rfmUrl = `${API}/api/analytics/rfm/heatmap?${params.toString()}`;

        try {
          const r = await fetch(rfmUrl);
          if (r.ok) {
          const cells = (await r.json()) as RfmCell[];
          // turn into buckets like "R5-F4" and pick top 10 by count
          const buckets: RfmPoint[] = cells
            .map(c => ({ bucket: `R${c.recency}-F${c.frequency}`, count: c.count }))
            .filter(b => b.count > 0)
            .sort((a,b) => b.count - a.count)
            .slice(0, 10);
           setRfmData(buckets);
         } else {
           setRfmData([]);
         }
        } catch {
         setRfmData([]);
        }

        // Segments
        const segUrl = `${API}/api/analytics/segments/summary?${params.toString()}`;
        try {
          const r = await fetch(segUrl);
          setSegmentData(r.ok ? (await r.json() as SegmentPoint[]) : []);
        } catch { setSegmentData([]); }

      } catch (e) {
        console.error('Analytics fetch error:', e);
        setSalesData([]); setRfmData([]); setSegmentData([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [hasMounted, filter.type, filter.category, filter.coupon, start, end]);

  if (!hasMounted) return null;

  return (
    <div className="min-h-screen p-6 md:p-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">

        {/* Header + filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-bold">Analytics</h1>
          <div className="flex items-center gap-2">
            <FilterBar
              filter={filter}
              setFilter={setFilter}
              categories={categories}
              coupons={coupons}
              loadingMeta={loadingMeta}
            />
            <DarkToggle />
          </div>
        </div>

        {/* Row 1: Revenue / Orders (keep) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCard title="Revenue Trend">
            {loading ? <ChartSkeleton /> : (
              salesData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salesData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(v: number) => [`${fmtMoney(v)}`, 'Revenue']} />
                    <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <Empty />
            )}
          </ChartCard>

          <ChartCard title="Orders Trend">
            {loading ? <ChartSkeleton /> : (
              salesData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="orders" fill="#10b981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty />
            )}
          </ChartCard>
        </div>

        {/* Row 2: RFM / Segment */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCard title="RFM Distribution (customers)">
            {loading ? <ChartSkeleton /> : (
              rfmData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rfmData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bucket" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#7c3aed" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty note="Wire /api/analytics.js" />
            )}
          </ChartCard>

          <ChartCard title="Segment Breakdown (customers)">
            {loading ? <ChartSkeleton /> : (
              segmentData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={segmentData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="segment" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="customers" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <Empty note="Wire /api/analytics.js" />
            )}
          </ChartCard>
        </div>

      </div>
    </div>
  );
}

/* ————— helpers ————— */
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${card} ${pad} min-w-0`}>
      <h2 className={sectionTitle}>{title}</h2>
      <div className="mt-4 w-full h-80">{children}</div>
    </div>
  );
}
function ChartSkeleton() { return <div className="h-80 rounded-2xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 animate-pulse" />; }
function Empty({ note }: { note?: string }) {
  return (
    <div className="flex h-full items-center justify-center text-gray-500 text-sm">
      {note ?? 'No data'}
    </div>
  );
}
