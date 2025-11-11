
'use client';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export default function DarkToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isDark = (theme ?? resolvedTheme) === 'dark';
  return (
    <button
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2 text-sm
                 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10"
    >
      {isDark ? '🌙 Dark' : '☀️ Light'}
    </button>
  );
}
