import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's own sizes, so it read our type scale
 * (text-caption, text-h2…) as colours and dropped it whenever a colour class
 * came after it: a chip asked for text-caption and rendered at body size.
 * The design system's sizes, from tailwind.config.ts, are named here.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display-xl', 'display-lg', 'display', 'h1', 'h2', 'h3', 'body-lg', 'body', 'label', 'caption', 'mono-data'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

export function formatRupeesCompact(paise: number): string {
  // A loss compacts like a profit, with its sign in front.
  if (paise < 0) return `−${formatRupeesCompact(-paise)}`;
  const rupees = paise / 100;
  if (rupees >= 10_000_000) {
    return `₹${(rupees / 10_000_000).toFixed(2)} Cr`;
  }
  if (rupees >= 100_000) {
    return `₹${(rupees / 100_000).toFixed(2)} L`;
  }
  if (rupees >= 1_000) {
    return `₹${(rupees / 1_000).toFixed(1)}K`;
  }
  return formatRupees(paise);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}
