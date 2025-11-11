'use client';

import { useEffect, useMemo, useState } from 'react';
import { DollarSign, ShoppingCart, LineChart as LineIcon, Package, Users } from 'lucide-react';
import { useHasMounted } from '@/hooks/useHasMounted';
import DarkToggle from '@/components/DarkToggle';
import { FilterBar, FilterState } from '@/components/FilterBar';
import Link from 'next/link';

interface KPI { revenue: number; orders: number; aov: number; units: number; uniqueCustomers: number; }
interface Product { id: number; name: string; price: number; total_sales: number; sku: string | null; }

const API = process.env.NEXT_PUBLIC_API_BASE!;
const STORE_ID = process.env.NEXT_PUBLIC_STORE_ID!;

const pad = 'p-5 md:p-6';
const card = 'rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 shadow-sm';
const sectionTitle = 'text-xl font-semibold text-gray-800 dark:text-gray-100';
const fmtMoney = (n: number | undefined) =>
  typeof n === 'number' ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '$0';
const toISO = (d: Date) => new Date(d).toISOString();

export default function DashboardPage() {
  const hasMounted = useHasMounted();

  // data
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KPI | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  // filters (shared pattern)
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

  // load meta (categories/coupons) once
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
        const cats = await catsRes.json();
        const coups = await coupsRes.json();
        if (!alive) return;
        setCategories(Array.isArray(cats) ? cats.filter((x): x is string => typeof x === 'string') : []);
        setCoupons(Array.isArray(coups) ? coups.filter((x): x is string => typeof x === 'string') : []);
      } finally {
        if (alive) setLoadingMeta(false);
      }
    })();
    return () => { alive = false; };
  }, [hasMounted]);

  // fetch KPIs + Popular products
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

        const kpisUrl = `${API}/api/kpis?${params.toString()}`;

        const prodParams = new URLSearchParams({ storeId: STORE_ID, limit: '5' });
        if (filter.type === 'category' && filter.category) prodParams.set('category', filter.category);
        const productsUrl = `${API}/api/products/popular?${prodParams.toString()}`;

        const [kRes, pRes] = await Promise.all([fetch(kpisUrl), fetch(productsUrl)]);
        const [k, p] = await Promise.all([kRes.json(), pRes.json()]);
        setKpis(k);
        setProducts(Array.isArray(p) ? p : []);
      } catch (e) {
        console.error('Home fetch error:', e);
        setKpis({ revenue: 0, orders: 0, aov: 0, units: 0, uniqueCustomers: 0 });
        setProducts([]);
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
          <h1 className="text-3xl font-bold">WooCommerce Analytics Dashboard</h1>
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

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          {loading
            ? Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)
            : <>
                <StatCard icon={<DollarSign />} label="Revenue" value={fmtMoney(kpis?.revenue)} />
                <StatCard icon={<ShoppingCart />} label="Orders" value={(kpis?.orders ?? 0).toLocaleString()} />
                <StatCard icon={<LineIcon />} label="AOV" value={fmtMoney(kpis?.aov)} />
                <StatCard icon={<Package />} label="Units Sold" value={(kpis?.units ?? 0).toLocaleString()} />
                <StatCard icon={<Users />} label="Customers" value={(kpis?.uniqueCustomers ?? 0).toLocaleString()} />
              </>
          }
        </div>

        {/* Products */}
        <div className={`${card} ${pad}`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className={sectionTitle}>Popular Products</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {filter.type === 'category' && filter.category
                  ? `Category: ${filter.category}`
                  : 'All categories'}
                {filter.type === 'coupon' && filter.coupon
                  ? ` • Coupon: ${filter.coupon}`
                  : ''}
              </p>
            </div>

          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/analytics"
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50
                        dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/10"><strong>Analytics</strong> →
            </Link>
          </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600">
                  <th className="py-3">Product</th>
                  <th className="py-3">SKU</th>
                  <th className="py-3">Price</th>
                  <th className="py-3">Units Sold</th>
                  <th className="py-3">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {products.length ? products.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="py-3 font-medium text-gray-900 dark:text-gray-100">{p.name}</td>
                    <td className="py-3 text-gray-500">{p.sku || 'N/A'}</td>
                    <td className="py-3 text-gray-900 dark:text-gray-100">{fmtMoney(p.price)}</td>
                    <td className="py-3 text-gray-900 dark:text-gray-100">{(p.total_sales ?? 0).toLocaleString()}</td>
                    <td className="py-3 font-medium text-gray-900 dark:text-gray-100">{fmtMoney(p.price * (p.total_sales || 0))}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="py-12 text-center text-gray-500">No products data</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={`${card} ${pad} flex items-center gap-4`}>
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200">{icon}</div>
      <div>
        <p className="text-sm text-gray-600 dark:text-gray-400">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
      </div>
    </div>
  );
}
function CardSkeleton() { return <div className="h-24 rounded-2xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 animate-pulse" />; }
