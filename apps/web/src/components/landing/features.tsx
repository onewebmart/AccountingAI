import {
  BarChart3,
  BookOpen,
  Building2,
  Check,
  FileCheck2,
  FolderOpen,
  Hash,
  History,
  IndianRupee,
  Lock,
  ReceiptText,
  Scale,
  ScanText,
  ShieldCheck,
  ShoppingCart,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { Reveal, RevealGroup, RevealItem } from './reveal';
import { cn } from '@/lib/utils';
import { Eyebrow, container, h2Class, sectionY } from './shared';

/**
 * What the product does, module by module. Every line maps to a screen that
 * exists in the app; nothing here is a roadmap item.
 */
const FEATURES: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: ScanText,
    title: 'AI document reading',
    body: 'Upload bills, invoices and receipts, or email them in. AI reads each one and proposes the entry. Nothing posts until a person approves, and if a read fails it tells you why.',
  },
  {
    icon: ReceiptText,
    title: 'Sales and invoicing',
    body: 'Customers with GSTIN autofill, quotes, sales orders, invoices and recurring invoices, delivery challans, payments received, credit notes and e-invoicing with IRN.',
  },
  {
    icon: ShoppingCart,
    title: 'Purchases and expenses',
    body: 'Vendors, itemised and mileage expenses, bulk entry, purchase orders, bills and recurring bills, vendor credits, 3-way match and payment runs.',
  },
  {
    icon: FileCheck2,
    title: 'GST and TDS',
    body: 'GSTR-1 and GSTR-3B prepared from your books, GSTR-2B reconciliation, and TDS tracked from deduction to payable to challan.',
  },
  {
    icon: Building2,
    title: 'Banking',
    body: 'Import bank statements as PDF, CSV or Excel, then reconcile them and match each line to what is already in your books.',
  },
  {
    icon: BarChart3,
    title: '89 reports',
    body: 'Schedule III profit and loss and balance sheet, cash flow and ageing, plus custom reports and reports scheduled to your inbox.',
  },
  {
    icon: BookOpen,
    title: 'Tools for your accountant',
    body: 'Manual journals with auto-reversal, chart of accounts, budgets, bulk reclassification, base-currency adjustment and locking by module.',
  },
  {
    icon: Timer,
    title: 'Time tracking',
    body: 'Projects, timesheets and a running timer. Turn logged hours into an invoice without re-typing them.',
  },
  {
    icon: FolderOpen,
    title: 'Documents',
    body: 'One library for every file, organised in folders, with your bank statements kept alongside the rest.',
  },
];

const CA_FIRM = [
  'A client book with every business you keep books for',
  'Compliance deadlines for GST, TDS, ITR and ROC',
  'Document requests that show what each client still owes you',
  'Practice invoices for your own fees',
  'A client portal in your firm’s name',
  'Guides in English and Hindi for every section',
];

const SAFEGUARDS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: Scale, title: 'Always balanced', body: 'Every entry is double entry. Debits equal credits, or it is not saved.' },
  { icon: Lock, title: 'Never edited after posting', body: 'A posted entry is corrected by a reversing entry, so the trail stays intact.' },
  { icon: Hash, title: 'Gapless numbering', body: 'Voucher numbers run in sequence for each financial year, with no gaps.' },
  { icon: History, title: 'Every change logged', body: 'Who changed what, and when, is recorded for every record in the books.' },
  { icon: ShieldCheck, title: 'Your data stays yours', body: 'Each business is kept apart at the database layer, not only on screen.' },
  { icon: IndianRupee, title: 'Exact to the paisa', body: 'Money is stored in whole paise, so no amount drifts or rounds away.' },
];

export function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className={cn('scroll-mt-16 bg-surface-card', sectionY)}>
      <div className={container}>
        <Reveal className="max-w-3xl">
          <Eyebrow>Features</Eyebrow>
          <h2 id="features-title" className={cn(h2Class, 'mt-3')}>
            Everything your books need, in one place
          </h2>
          <p className="mt-4 text-body-lg text-ink-500">
            From the first invoice to the GST return, every module writes to the same double-entry
            ledger, so the reports always agree with the transactions behind them.
          </p>
        </Reveal>

        <RevealGroup className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6" gap={0.06}>
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <RevealItem key={title} className="h-full">
              <article className="group h-full rounded-2xl border border-line-200 bg-surface-card p-6 transition-[border-color,box-shadow,transform] duration-200 hover:border-brand-200 hover:shadow-e2 motion-safe:hover:-translate-y-0.5">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 transition-colors duration-200 group-hover:bg-brand-600 group-hover:text-white">
                  <Icon size={22} aria-hidden />
                </span>
                <h3 className="mt-5 font-heading text-h3 text-navy-900">{title}</h3>
                <p className="mt-2 text-body text-ink-500">{body}</p>
              </article>
            </RevealItem>
          ))}
        </RevealGroup>

        {/* For CA firms: the practice side, which a single business never sees. */}
        <Reveal className="mt-6">
          <div
            id="ca-firms"
            className="scroll-mt-24 grid gap-8 rounded-2xl border border-navy-100 bg-navy-50 p-6 sm:p-8 lg:grid-cols-[1fr_1.3fr] lg:gap-12 lg:p-12"
          >
            <div>
              <Eyebrow>For CA firms</Eyebrow>
              <h3 className="mt-3 font-heading text-h1 text-navy-900">
                Run your practice and your clients’ books side by side
              </h3>
              <p className="mt-3 text-body-lg text-ink-600">
                Keep every client’s books in one login, see which filings are due, and collect the
                documents you need without chasing on the phone.
              </p>
              <a
                href="#pricing"
                className="mt-6 inline-flex items-center gap-1 rounded-md text-body font-semibold text-brand-700 hover:text-brand-800 hover:underline"
              >
                See the CA Firm plan
              </a>
            </div>
            <ul className="grid content-center gap-x-6 gap-y-4 sm:grid-cols-2">
              {CA_FIRM.map((item) => (
                <li key={item} className="flex gap-3 text-body text-ink-700">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
                    <Check size={13} strokeWidth={3} aria-hidden />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        {/* Safeguards: structural, not settings anyone can switch off. */}
        <div id="safeguards" className="mt-20 scroll-mt-24 border-t border-line-100 pt-16">
          <Reveal className="max-w-2xl">
            <Eyebrow>Safeguards</Eyebrow>
            <h3 className="mt-3 font-heading text-h1 text-navy-900">Built so every number can be defended</h3>
            <p className="mt-3 text-body-lg text-ink-500">
              These rules are part of how the ledger is built, not settings someone can switch off.
            </p>
          </Reveal>
          <RevealGroup className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3" gap={0.05}>
            {SAFEGUARDS.map(({ icon: Icon, title, body }) => (
              <RevealItem key={title}>
                <div className="flex gap-4">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-brand-400">
                    <Icon size={20} aria-hidden />
                  </span>
                  <div>
                    <p className="font-heading text-body-lg font-bold text-navy-900">{title}</p>
                    <p className="mt-1 text-body text-ink-500">{body}</p>
                  </div>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </div>
    </section>
  );
}
