'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { api } from '@/lib/api';
import { GST_STATES } from '@/lib/gst';
import { formatRupees } from '@/lib/utils';

// ── Shapes returned by GET /gst/returns/* (all money in paise) ──────────────

interface Heads {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

interface Issue {
  level: 'block' | 'note';
  message: string;
  documentId?: string;
}

interface ReturnDoc {
  id: string;
  number: string;
  date: string;
  pos: string;
  valuePaise: number;
  items: Array<Heads & { rate: number }>;
}

interface HsnRow extends Heads {
  hsn: string;
  description: string;
  uqc: string;
  qty: number;
  rate: number;
}

interface Gstr1 {
  period: string;
  gstin: string | null;
  b2b: Array<{ ctin: string; customerName: string; invoices: ReturnDoc[] }>;
  b2cl: Array<{ pos: string; invoices: ReturnDoc[] }>;
  b2cs: Array<Heads & { supplyType: 'INTRA' | 'INTER'; pos: string; rate: number }>;
  nil: Array<{ supplyType: string; nilPaise: number }>;
  cdnr: Array<{ ctin: string; customerName: string; notes: ReturnDoc[] }>;
  cdnur: ReturnDoc[];
  hsn: { b2b: HsnRow[]; b2c: HsnRow[] };
  docs: Array<{ kind: 'invoices' | 'credit_notes'; from: string; to: string; count: number }>;
  summary: Array<Heads & { section: string; label: string; count: number }>;
  issues: Issue[];
}

type Head = 'igst' | 'cgst' | 'sgst' | 'cess';

interface Gstr3b {
  period: string;
  gstin: string | null;
  outwardTaxable: Heads;
  outwardNil: Heads;
  inwardReverseCharge: Heads;
  interStateUnregistered: Array<{ pos: string; txval: number; iamt: number }>;
  itcReverseCharge: Heads;
  itcOther: Heads;
  itcNet: Heads;
  inwardExempt: { inter: number; intra: number };
  setOff: {
    rows: Array<{
      head: Head;
      liabilityPaise: number;
      reverseChargePaise: number;
      fromCredit: Record<Head, number>;
      cashPaise: number;
    }>;
    creditLeft: Record<Head, number>;
    cashTotalPaise: number;
  };
  issues: Issue[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const HEAD_LABEL: Record<Head, string> = { igst: 'IGST', cgst: 'CGST', sgst: 'SGST', cess: 'Cess' };

function stateLabel(code: string): string {
  const name = GST_STATES.find((s) => s.code === code)?.name;
  return name ? `${code} · ${name}` : code || '—';
}

const tax = (h: Heads) => h.iamt + h.camt + h.samt + h.csamt;

/** 2026-09 → 092026, the portal's period in file names. */
const portalPeriod = (period: string) => `${period.slice(5, 7)}${period.slice(0, 4)}`;

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const th = 'px-3 py-2 text-caption font-medium text-ink-500 whitespace-nowrap';
const td = 'px-3 py-2 text-body text-ink-900 whitespace-nowrap';
const num = `${td} text-right font-mono`;

function Money({ paise }: { paise: number }) {
  return <>{paise === 0 ? <span className="text-ink-400">—</span> : formatRupees(paise)}</>;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-body font-semibold text-ink-900">{title}</h3>
        {hint && <p className="text-caption text-ink-500">{hint}</p>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line-200 bg-surface-card">{children}</div>
    </section>
  );
}

function HeadsRow({ label, heads, count }: { label: string; heads: Heads; count?: number }) {
  return (
    <tr className="border-t border-line-100">
      <td className={td}>{label}</td>
      {count !== undefined && <td className={num}>{count}</td>}
      <td className={num}><Money paise={heads.txval} /></td>
      <td className={num}><Money paise={heads.iamt} /></td>
      <td className={num}><Money paise={heads.camt} /></td>
      <td className={num}><Money paise={heads.samt} /></td>
      <td className={num}><Money paise={heads.csamt} /></td>
    </tr>
  );
}

function HeadsHeader({ first, withCount }: { first: string; withCount?: boolean }) {
  return (
    <thead className="bg-surface-sink">
      <tr>
        <th className={`${th} text-left`}>{first}</th>
        {withCount && <th className={`${th} text-right`}>Count</th>}
        <th className={`${th} text-right`}>Taxable value</th>
        <th className={`${th} text-right`}>IGST</th>
        <th className={`${th} text-right`}>CGST</th>
        <th className={`${th} text-right`}>SGST</th>
        <th className={`${th} text-right`}>Cess</th>
      </tr>
    </thead>
  );
}

function Issues({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  const blocks = issues.filter((i) => i.level === 'block');
  const notes = issues.filter((i) => i.level === 'note');
  return (
    <div className="space-y-2">
      {blocks.length > 0 && (
        <div className="rounded-lg border border-error-fg/30 bg-error-bg px-4 py-3">
          <p className="mb-1 flex items-center gap-2 text-body font-semibold text-error-fg">
            <AlertCircle size={16} /> Fix before filing
          </p>
          <ul className="list-disc space-y-0.5 pl-6 text-body text-ink-900">
            {blocks.map((i, n) => <li key={n}>{i.message}</li>)}
          </ul>
        </div>
      )}
      {notes.length > 0 && (
        <div className="rounded-lg border border-pending-fg/30 bg-pending-bg px-4 py-3">
          <p className="mb-1 flex items-center gap-2 text-body font-semibold text-pending-fg">
            <AlertTriangle size={16} /> Worth a look
          </p>
          <ul className="list-disc space-y-0.5 pl-6 text-body text-ink-900">
            {notes.map((i, n) => <li key={n}>{i.message}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── GSTR-1 ──────────────────────────────────────────────────────────────────

function Gstr1View({ r }: { r: Gstr1 }) {
  const docs = [
    ...r.b2b.flatMap((p) => p.invoices.map((d) => ({ ...d, party: p.customerName, gstin: p.ctin, table: 'B2B' }))),
    ...r.b2cl.flatMap((g) => g.invoices.map((d) => ({ ...d, party: 'Unregistered', gstin: '', table: 'B2CL' }))),
    ...r.cdnr.flatMap((p) => p.notes.map((d) => ({ ...d, party: p.customerName, gstin: p.ctin, table: 'Credit note' }))),
    ...r.cdnur.map((d) => ({ ...d, party: 'Unregistered', gstin: '', table: 'Credit note' })),
  ];
  const hsn = [...r.hsn.b2b.map((h) => ({ ...h, to: 'B2B' })), ...r.hsn.b2c.map((h) => ({ ...h, to: 'B2C' }))];

  return (
    <div className="space-y-6">
      <Section title="Summary" hint="Each table of the return, net of credit notes where the portal nets them.">
        <table className="w-full">
          <HeadsHeader first="Table" withCount />
          <tbody>
            {r.summary.map((row) => <HeadsRow key={row.section} label={row.label} heads={row} count={row.count} />)}
          </tbody>
        </table>
      </Section>

      {docs.length > 0 && (
        <Section title="Invoices and notes reported one by one" hint="B2B, B2C large and credit notes.">
          <table className="w-full">
            <thead className="bg-surface-sink">
              <tr>
                <th className={`${th} text-left`}>Table</th>
                <th className={`${th} text-left`}>Number</th>
                <th className={`${th} text-left`}>Date</th>
                <th className={`${th} text-left`}>Customer</th>
                <th className={`${th} text-left`}>Place of supply</th>
                <th className={`${th} text-right`}>Value</th>
                <th className={`${th} text-right`}>Taxable</th>
                <th className={`${th} text-right`}>Tax</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={`${d.table}-${d.id}`} className="border-t border-line-100">
                  <td className={`${td} text-caption text-ink-500`}>{d.table}</td>
                  <td className={`${td} font-mono`}>{d.number}</td>
                  <td className={`${td} font-mono`}>{d.date}</td>
                  <td className={td}>
                    {d.party}
                    {d.gstin && <span className="ml-2 font-mono text-caption text-ink-500">{d.gstin}</span>}
                  </td>
                  <td className={`${td} text-caption`}>{stateLabel(d.pos)}</td>
                  <td className={num}>{formatRupees(d.valuePaise)}</td>
                  <td className={num}>{formatRupees(d.items.reduce((s, i) => s + i.txval, 0))}</td>
                  <td className={num}>{formatRupees(d.items.reduce((s, i) => s + tax(i), 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {r.b2cs.length > 0 && (
        <Section title="B2C others (table 7)" hint="Sales to unregistered customers, by state and rate.">
          <table className="w-full">
            <HeadsHeader first="Supply · state · rate" />
            <tbody>
              {r.b2cs.map((row) => (
                <HeadsRow
                  key={`${row.supplyType}-${row.pos}-${row.rate}`}
                  label={`${row.supplyType === 'INTER' ? 'Inter-state' : 'Intra-state'} · ${stateLabel(row.pos)} · ${row.rate}%`}
                  heads={row}
                />
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {hsn.length > 0 && (
        <Section title="HSN summary (table 12)">
          <table className="w-full">
            <thead className="bg-surface-sink">
              <tr>
                <th className={`${th} text-left`}>To</th>
                <th className={`${th} text-left`}>HSN/SAC</th>
                <th className={`${th} text-left`}>Description</th>
                <th className={`${th} text-left`}>UQC</th>
                <th className={`${th} text-right`}>Qty</th>
                <th className={`${th} text-right`}>Rate</th>
                <th className={`${th} text-right`}>Taxable</th>
                <th className={`${th} text-right`}>Tax</th>
              </tr>
            </thead>
            <tbody>
              {hsn.map((h) => (
                <tr key={`${h.to}-${h.hsn}-${h.rate}`} className="border-t border-line-100">
                  <td className={`${td} text-caption text-ink-500`}>{h.to}</td>
                  <td className={`${td} font-mono`}>{h.hsn || <span className="text-pending-fg">Not given</span>}</td>
                  <td className={td}>{h.description || '—'}</td>
                  <td className={`${td} font-mono text-caption`}>{h.uqc}</td>
                  <td className={num}>{h.qty}</td>
                  <td className={num}>{h.rate}%</td>
                  <td className={num}>{formatRupees(h.txval)}</td>
                  <td className={num}>{formatRupees(tax(h))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {r.docs.length > 0 && (
        <Section title="Documents issued (table 13)">
          <table className="w-full">
            <thead className="bg-surface-sink">
              <tr>
                <th className={`${th} text-left`}>Document</th>
                <th className={`${th} text-left`}>From</th>
                <th className={`${th} text-left`}>To</th>
                <th className={`${th} text-right`}>Issued</th>
              </tr>
            </thead>
            <tbody>
              {r.docs.map((d) => (
                <tr key={d.kind} className="border-t border-line-100">
                  <td className={td}>{d.kind === 'invoices' ? 'Invoices for outward supply' : 'Credit notes'}</td>
                  <td className={`${td} font-mono`}>{d.from}</td>
                  <td className={`${td} font-mono`}>{d.to}</td>
                  <td className={num}>{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}

// ── GSTR-3B ─────────────────────────────────────────────────────────────────

function Gstr3bView({ r }: { r: Gstr3b }) {
  const { setOff } = r;
  const creditLeft = Object.values(setOff.creditLeft).reduce((s, v) => s + v, 0);
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-line-200 bg-surface-card p-5">
        <p className="text-caption text-ink-500">Tax to pay in cash this month, after input credit</p>
        <p className="mt-1 font-mono text-h1 font-semibold text-ink-900">{formatRupees(setOff.cashTotalPaise)}</p>
        {creditLeft > 0 && (
          <p className="mt-1 text-caption text-ink-500">
            {formatRupees(creditLeft)} of credit carries forward to next month.
          </p>
        )}
      </div>

      <Section title="3.1 Outward supplies and inward supplies on reverse charge">
        <table className="w-full">
          <HeadsHeader first="Nature of supplies" />
          <tbody>
            <HeadsRow label="(a) Outward taxable supplies" heads={r.outwardTaxable} />
            <HeadsRow label="(c) Nil rated and exempted" heads={r.outwardNil} />
            <HeadsRow label="(d) Inward supplies on reverse charge" heads={r.inwardReverseCharge} />
          </tbody>
        </table>
      </Section>

      {r.interStateUnregistered.length > 0 && (
        <Section title="3.2 Inter-state supplies to unregistered persons">
          <table className="w-full">
            <thead className="bg-surface-sink">
              <tr>
                <th className={`${th} text-left`}>Place of supply</th>
                <th className={`${th} text-right`}>Taxable value</th>
                <th className={`${th} text-right`}>IGST</th>
              </tr>
            </thead>
            <tbody>
              {r.interStateUnregistered.map((row) => (
                <tr key={row.pos} className="border-t border-line-100">
                  <td className={td}>{stateLabel(row.pos)}</td>
                  <td className={num}>{formatRupees(row.txval)}</td>
                  <td className={num}>{formatRupees(row.iamt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="4 Eligible input tax credit" hint="From your posted bills, net of debit notes. Compare with GSTR-2B before claiming.">
        <table className="w-full">
          <HeadsHeader first="Details" />
          <tbody>
            <HeadsRow label="(A)(3) Inward supplies on reverse charge" heads={r.itcReverseCharge} />
            <HeadsRow label="(A)(5) All other ITC" heads={r.itcOther} />
            <HeadsRow label="(C) Net ITC available" heads={r.itcNet} />
          </tbody>
        </table>
      </Section>

      <Section title="5 Exempt, nil rated and non-GST inward supplies">
        <table className="w-full">
          <thead className="bg-surface-sink">
            <tr>
              <th className={`${th} text-left`}>Nature</th>
              <th className={`${th} text-right`}>Inter-state</th>
              <th className={`${th} text-right`}>Intra-state</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line-100">
              <td className={td}>Exempt and nil rated purchases</td>
              <td className={num}><Money paise={r.inwardExempt.inter} /></td>
              <td className={num}><Money paise={r.inwardExempt.intra} /></td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section
        title="6.1 Payment of tax"
        hint="IGST credit goes first; CGST credit never pays SGST, nor SGST credit CGST. Reverse-charge tax is always paid in cash."
      >
        <table className="w-full">
          <thead className="bg-surface-sink">
            <tr>
              <th className={`${th} text-left`}>Tax</th>
              <th className={`${th} text-right`}>Due</th>
              <th className={`${th} text-right`}>Reverse charge</th>
              <th className={`${th} text-right`}>From IGST credit</th>
              <th className={`${th} text-right`}>From CGST credit</th>
              <th className={`${th} text-right`}>From SGST credit</th>
              <th className={`${th} text-right`}>From cess credit</th>
              <th className={`${th} text-right`}>In cash</th>
            </tr>
          </thead>
          <tbody>
            {setOff.rows.map((row) => (
              <tr key={row.head} className="border-t border-line-100">
                <td className={td}>{HEAD_LABEL[row.head]}</td>
                <td className={num}><Money paise={row.liabilityPaise} /></td>
                <td className={num}><Money paise={row.reverseChargePaise} /></td>
                <td className={num}><Money paise={row.fromCredit.igst} /></td>
                <td className={num}><Money paise={row.fromCredit.cgst} /></td>
                <td className={num}><Money paise={row.fromCredit.sgst} /></td>
                <td className={num}><Money paise={row.fromCredit.cess} /></td>
                <td className={`${num} font-semibold`}><Money paise={row.cashPaise} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

type ReturnKind = 'gstr1' | 'gstr3b';

/**
 * GSTR-1 and GSTR-3B for a month, worked out from what was posted, with the
 * portal JSON to download. Anything that would make the portal refuse the
 * return is listed first, in red, and holds back the download.
 */
export function GstReturnsPanel({ period, onDownloaded }: { period: string; onDownloaded: (message: string) => void }) {
  const [kind, setKind] = useState<ReturnKind>('gstr1');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const gstr1 = useQuery<Gstr1>({
    queryKey: ['gst', 'returns', 'gstr1', period],
    queryFn: () => api.get<Gstr1>(`/gst/returns/gstr1?period=${period}`),
    enabled: kind === 'gstr1',
  });
  const gstr3b = useQuery<Gstr3b>({
    queryKey: ['gst', 'returns', 'gstr3b', period],
    queryFn: () => api.get<Gstr3b>(`/gst/returns/gstr3b?period=${period}`),
    enabled: kind === 'gstr3b',
  });
  const active = kind === 'gstr1' ? gstr1 : gstr3b;
  const issues = active.data?.issues ?? [];
  const blocked = issues.some((i) => i.level === 'block');
  const label = kind === 'gstr1' ? 'GSTR-1' : 'GSTR-3B';

  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const json = await api.get<unknown>(`/gst/returns/${kind}/json?period=${period}`);
      const gstin = active.data?.gstin ?? 'GSTIN';
      downloadJson(json, `${label.replace('-', '')}_${gstin}_${portalPeriod(period)}.json`);
      onDownloaded(`${label} JSON downloaded`);
    } catch (err) {
      setDownloadError(err instanceof Error && err.message ? err.message : `Couldn't download the ${label} JSON.`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-line-200 bg-surface-card p-0.5" role="tablist">
          {(['gstr1', 'gstr3b'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={`rounded px-3 py-1.5 text-body font-medium transition-colors ${
                kind === k ? 'bg-saffron-600 text-white' : 'text-ink-700 hover:bg-surface-sink'
              }`}
            >
              {k === 'gstr1' ? 'GSTR-1' : 'GSTR-3B'}
            </button>
          ))}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            variant="secondary"
            onClick={() => void download()}
            disabled={!active.data || blocked || downloading}
            title={blocked ? 'Fix the items in red first: the portal would refuse this file.' : undefined}
            className="flex items-center gap-2"
          >
            <Download size={14} />
            {downloading ? 'Preparing…' : `Download ${label} JSON`}
          </Button>
          {downloadError && <p className="text-caption text-error-fg">{downloadError}</p>}
        </div>
      </div>

      {active.isError ? (
        <QueryError error={active.error} onRetry={() => void active.refetch()} />
      ) : active.isLoading || !active.data ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-surface-sink animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <Issues issues={issues} />
          {kind === 'gstr1' ? <Gstr1View r={gstr1.data!} /> : <Gstr3bView r={gstr3b.data!} />}
          <p className="text-caption text-ink-500">
            Worked out from posted invoices, bills and notes dated in this month. Check the JSON in the GST offline
            tool before uploading.
          </p>
        </>
      )}
    </div>
  );
}
