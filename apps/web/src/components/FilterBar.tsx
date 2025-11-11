'use client';

import DateRangePicker, { DateRangeValue } from '@/components/DateRangePicker';

export type FilterType = 'date' | 'category' | 'coupon';

export type FilterState = {
  type: FilterType;
  date?: DateRangeValue;
  category?: string;
  coupon?: string;
};

export function FilterBar({
  filter,
  setFilter,
  categories,
  coupons,
  loadingMeta,
}: {
  filter: FilterState;
  setFilter: (f: FilterState) => void;
  categories: string[];
  coupons: string[];
  loadingMeta: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Filter type */}
      <select
        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm
                   dark:border-white/10 dark:bg-white/5"
        value={filter.type}
        onChange={(e) => {
          const t = e.target.value as FilterType;
          if (t === 'date') {
            const to = new Date();
            const from = new Date(); from.setDate(from.getDate() - 30);
            setFilter({ type: 'date', date: { from, to } });
          } else if (t === 'category') {
            setFilter({ type: 'category', date: filter.date, category: '' });
          } else {
            setFilter({ type: 'coupon', date: filter.date, coupon: '' });
          }
        }}
      >
        <option value="date">Date</option>
        <option value="category">Category</option>
        <option value="coupon">Coupon</option>
      </select>

      {/* Context control */}
      {filter.type === 'date' && (
        <DateRangePicker
          value={filter.date ?? null}
          onChange={(d) => setFilter({ ...filter, type: 'date', date: d })}
        />
      )}

      {filter.type === 'category' && (
        <select
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm
                     dark:border-white/10 dark:bg-white/5"
          value={filter.category ?? ''}
          onChange={(e) => setFilter({ ...filter, type: 'category', category: e.target.value })}
          disabled={loadingMeta}
        >
          <option value="">{loadingMeta ? 'Loading…' : 'All categories'}</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {filter.type === 'coupon' && (
        <select
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm
                     dark:border-white/10 dark:bg-white/5"
          value={filter.coupon ?? ''}
          onChange={(e) => setFilter({ ...filter, type: 'coupon', coupon: e.target.value })}
          disabled={loadingMeta}
        >
          <option value="">{loadingMeta ? 'Loading…' : 'All coupons'}</option>
          {coupons.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
    </div>
  );
}
