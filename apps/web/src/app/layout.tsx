import type { Metadata } from 'next';
import { Inter, Manrope } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

// Headings: Manrope Bold. Body, buttons and figures: Inter.
const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700', '800'],
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: {
    default: 'AiBooks — Smart Accounting. Smarter Business Decisions.',
    template: '%s | AiBooks',
  },
  description:
    'Simplify accounting with AI-powered invoicing, GST management, expense tracking and real-time financial insights — all in one platform.',
  keywords: ['accounting', 'GST', 'bookkeeping', 'India', 'SME', 'invoicing', 'Tally'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${inter.variable}`}
    >
      <body className="bg-surface-page text-ink-900 antialiased" style={{ fontFamily: 'var(--font-body)' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
