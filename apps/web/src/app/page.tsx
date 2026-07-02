import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      {/* ─── Hero ───────────────────────────────────────────────────── */}
      <section className="bg-roast-900 text-white px-6 py-24 text-center">
        <p className="text-label text-marigold-400 tracking-[0.12em] uppercase mb-4">
          Built for Indian SMEs &amp; CAs
        </p>
        <h1
          className="text-display font-display text-white mb-6 max-w-3xl mx-auto"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Upload the pile.{' '}
          <span className="text-marigold-400">We&apos;ll sort the books.</span>
        </h1>
        <p className="text-body-lg text-ink-400 max-w-xl mx-auto mb-10">
          Bank statements, bills, invoices — drop them in and watch entries appear, ready for your
          one-tap approval. GST-ready, Tally-friendly.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Button variant="primary" size="lg" asChild>
            <Link href="/auth/signup">Start free</Link>
          </Button>
          <Button
            variant="secondary"
            size="lg"
            className="bg-transparent border-white/20 text-white hover:bg-white/10"
            asChild
          >
            <Link href="#how-it-works">See how it works</Link>
          </Button>
        </div>
      </section>

      {/* ─── Loop section ───────────────────────────────────────────── */}
      <section id="how-it-works" className="px-6 py-20 max-w-content mx-auto">
        <h2 className="text-h2 font-display text-ink-900 text-center mb-12" style={{ fontFamily: 'var(--font-display)' }}>
          From pile to posted in minutes
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              step: '01',
              title: 'Upload anything',
              body: 'PDF bills, scanned receipts, bank statements, e-invoices. Drop them all in at once.',
            },
            {
              step: '02',
              title: 'AI reads and classifies',
              body: 'OCR + AI extracts every field — vendor, date, amounts, GST — with a confidence score on each.',
            },
            {
              step: '03',
              title: 'You approve, we post',
              body: 'Review the flagged fields, click Approve & post. Balanced double-entry journal lands in the ledger.',
            },
          ].map((item) => (
            <div key={item.step} className="rounded-md border border-line-200 p-6 bg-surface-card shadow-e1">
              <span className="text-display font-display text-marigold-400 opacity-30 block mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                {item.step}
              </span>
              <h3 className="text-h3 font-display text-ink-900 mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                {item.title}
              </h3>
              <p className="text-body text-ink-500">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Feature strip ──────────────────────────────────────────── */}
      <section className="bg-honey-50 px-6 py-16">
        <div className="max-w-content mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { label: 'GST-ready', desc: 'Auto purchase & sales registers, 2A/2B reconciliation' },
            { label: 'Tally export', desc: 'Local connector — sync approved vouchers idempotently' },
            { label: 'White-label', desc: 'CA firms get their own branded portal with client grid' },
            { label: 'Audit-proof', desc: 'Every change logged. Append-only ledger. Gapless numbers.' },
          ].map((f) => (
            <div key={f.label} className="text-center">
              <p className="text-h3 font-display text-ink-900 mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                {f.label}
              </p>
              <p className="text-caption text-ink-500">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── CTA ────────────────────────────────────────────────────── */}
      <section className="px-6 py-20 text-center">
        <h2 className="text-h2 font-display text-ink-900 mb-4" style={{ fontFamily: 'var(--font-display)' }}>
          Ready to clear the pile?
        </h2>
        <p className="text-body text-ink-500 mb-8">Free to start. No card needed.</p>
        <Button variant="primary" size="lg" asChild>
          <Link href="/auth/signup">Create your account</Link>
        </Button>
      </section>
    </main>
  );
}
