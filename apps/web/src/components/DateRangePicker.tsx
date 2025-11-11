'use client';

import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';

export type DateRangeValue = { from: Date; to: Date } | null;

export default function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
}) {
  const [open, setOpen] = useState(false);

  const label = value?.from
    ? value.to
      ? `${value.from.toLocaleDateString()} – ${value.to.toLocaleDateString()}`
      : value.from.toLocaleDateString()
    : 'Select dates';

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="inline-flex items-center gap-2 rounded-xl border border-gray-200 dark:border-white/10
                           bg-white dark:bg-white/5 px-3 py-2 text-sm">
          📅 {label}
        </button>
      </Popover.Trigger>
       <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-[1000] rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-neutral-900">
          <DayPicker
            mode="range"
            selected={value ?? undefined}
            onSelect={(r) => onChange(r && r.from ? { from: r.from, to: r.to ?? r.from }: null)}
            numberOfMonths={2}
            defaultMonth={value?.from ?? new Date()}
            className="z-[1000]"
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
