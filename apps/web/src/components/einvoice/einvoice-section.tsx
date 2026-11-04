'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

interface Issue {
  level: 'block' | 'warn';
  code: string;
  where: 'settings' | 'customer' | 'invoice' | 'item';
  message: string;
  fix: string;
}

interface EInvoice {
  _id: string;
  status: 'pending' | 'active' | 'failed' | 'cancelled';
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  irpErrors: Array<{ code: string; message: string }>;
  isTest: boolean;
  cancelReason: string | null;
}

interface EwayBill {
  _id: string;
  status: 'active' | 'cancelled';
  ewbNo: string;
  ewbDate: string;
  validUpto: string;
  distanceKm: number;
  mode: 'road' | 'rail' | 'air' | 'ship';
  vehicleNo: string | null;
  transporterName: string | null;
  isTest: boolean;
}

interface View {
  provider: { name: string; isMock: boolean };
  posted: boolean;
  applicable: boolean;
  precheck: Issue[];
  ready: boolean;
  einvoice: EInvoice | null;
  canCancelIrn: boolean;
  ewayBills: EwayBill[];
  ewbRequired: boolean;
}

interface Suggestion {
  mode: EwayBill['mode'];
  vehicleNo: string | null;
  transporterId: string | null;
  transporterName: string | null;
  distanceKm: number | null;
  basis: string;
}

const WHERE: Record<Issue['where'], string> = { settings: 'Settings', customer: 'Customer', invoice: 'Invoice', item: 'Item' };
const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * The invoice's e-invoice and e-way bill. Every call to the IRP or the
 * e-way bill system is a person's explicit action, confirmed first: an IRN
 * cannot be taken back except by cancelling it within a day.
 */
export function EinvoiceSection({ invoiceId, onToast }: { invoiceId: string; onToast?: (m: string) => void }) {
  const queryClient = useQueryClient();
  const key = ['einvoice', invoiceId];
  const { data, isLoading, isError, error } = useQuery({ queryKey: key, queryFn: () => api.get<View>(`/einvoice/invoices/${invoiceId}`) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['sales'] });
  };

  const generate = useMutation({ mutationFn: () => api.post(`/einvoice/invoices/${invoiceId}/irn`), onSuccess: () => { refresh(); onToast?.('IRN generated'); } });
  const [cancelling, setCancelling] = useState(false);
  const [cancelForm, setCancelForm] = useState({ reasonCode: '2', remark: '' });
  const cancel = useMutation({
    mutationFn: () => api.post(`/einvoice/invoices/${invoiceId}/irn/cancel`, cancelForm),
    onSuccess: () => { setCancelling(false); refresh(); onToast?.('IRN cancelled and sale reversed'); },
  });

  const [ewbOpen, setEwbOpen] = useState(false);
  const [ewb, setEwb] = useState({ distanceKm: '', mode: 'road' as EwayBill['mode'], vehicleNo: '', transporterId: '', transporterName: '', transDocNo: '', transDocDate: '' });
  const suggestion = useQuery({
    queryKey: ['einvoice', invoiceId, 'eway-suggestion'],
    queryFn: () => api.get<Suggestion | null>(`/einvoice/invoices/${invoiceId}/eway/suggestion`),
    enabled: ewbOpen,
  });
  const makeEwb = useMutation({
    mutationFn: () =>
      api.post(`/einvoice/invoices/${invoiceId}/eway`, {
        distanceKm: Number(ewb.distanceKm),
        mode: ewb.mode,
        ...(ewb.vehicleNo.trim() ? { vehicleNo: ewb.vehicleNo.trim() } : {}),
        ...(ewb.transporterId.trim() ? { transporterId: ewb.transporterId.trim() } : {}),
        ...(ewb.transporterName.trim() ? { transporterName: ewb.transporterName.trim() } : {}),
        ...(ewb.transDocNo.trim() ? { transDocNo: ewb.transDocNo.trim(), transDocDate: ewb.transDocDate } : {}),
      }),
    onSuccess: () => { setEwbOpen(false); refresh(); onToast?.('E-way bill generated'); },
  });
  const cancelEwb = useMutation({
    mutationFn: (id: string) => api.post(`/einvoice/eway/${id}/cancel`, { reasonCode: '3' }),
    onSuccess: () => { refresh(); onToast?.('E-way bill cancelled'); },
  });

  if (isLoading) return <p className="flex items-center gap-2 text-caption text-ink-400"><Loader2 size={12} className="animate-spin" /> Checking e-invoice…</p>;
  if (isError || !data) return <p className="text-caption text-error-fg">{message(error)}</p>;
  if (!data.posted) return null;

  const e = data.einvoice;
  const field = 'w-full rounded-md border border-line-200 bg-white px-2 py-1.5 text-caption text-ink-900';
  const activeEwb = data.ewayBills.find((b) => b.status === 'active');
  const s = suggestion.data;

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">E-invoice</p>
        {data.provider.isMock && <p className="mb-1 text-[0.7rem] text-ink-400">Test gateway: IRNs made here are not registered with the IRP.</p>}
        {!data.applicable ? (
          <p className="text-caption text-ink-500">The customer has no GSTIN: a B2C sale needs no IRN.</p>
        ) : e?.status === 'active' ? (
          <div className="rounded-md bg-success-bg p-2 text-caption text-success-fg">
            <p className="font-medium">Registered{e.isTest ? ' (test)' : ''}</p>
            <p className="break-all font-mono">IRN {e.irn}</p>
            <p className="font-mono">Ack {e.ackNo} · {e.ackDate ? when(e.ackDate) : ''}</p>
            {data.canCancelIrn && !cancelling && (
              <button type="button" className="mt-1 text-caption text-error-fg hover:underline" onClick={() => setCancelling(true)}>Cancel IRN</button>
            )}
            {!data.canCancelIrn && <p className="mt-1 text-ink-500">Past 24 hours: to undo it, raise a credit note.</p>}
          </div>
        ) : (
          <>
            {e?.status === 'cancelled' && <p className="mb-1 text-caption text-ink-500">IRN cancelled: {e.cancelReason}</p>}
            {e?.status === 'failed' && (
              <div className="mb-2 rounded-md bg-error-bg p-2 text-caption text-error-fg">
                The IRP refused it: {e.irpErrors.map((x) => `${x.message} (${x.code})`).join('; ')}
              </div>
            )}
            {data.precheck.length > 0 && (
              <ul className="mb-2 space-y-1">
                {data.precheck.map((i) => (
                  <li key={i.code} className={`rounded-md p-2 text-caption ${i.level === 'block' ? 'bg-error-bg text-error-fg' : 'bg-pending-bg text-pending-fg'}`}>
                    <span className="font-medium">{WHERE[i.where]}:</span> {i.message} <span className="text-ink-600">{i.fix}</span>
                  </li>
                ))}
              </ul>
            )}
            {e?.status !== 'cancelled' && (
              <Button
                size="sm"
                disabled={!data.ready || generate.isPending}
                onClick={() => {
                  if (window.confirm('Register this invoice with the IRP? An IRN can only be cancelled within 24 hours; after that, corrections are by credit note.')) generate.mutate();
                }}
              >
                {generate.isPending ? 'Generating…' : 'Generate IRN'}
              </Button>
            )}
            {generate.isError && <p className="mt-1 text-caption text-error-fg">{message(generate.error)}</p>}
          </>
        )}
        {cancelling && (
          <div className="mt-2 space-y-2 rounded-md border border-line-200 p-2">
            <select className={field} value={cancelForm.reasonCode} onChange={(ev) => setCancelForm((f) => ({ ...f, reasonCode: ev.target.value }))}>
              <option value="1">Duplicate</option>
              <option value="2">Data entry mistake</option>
              <option value="3">Order cancelled</option>
              <option value="4">Other</option>
            </select>
            <input className={field} placeholder="Why, in a few words" value={cancelForm.remark} onChange={(ev) => setCancelForm((f) => ({ ...f, remark: ev.target.value }))} />
            <p className="text-[0.7rem] text-ink-500">This cancels the IRN at the IRP and reverses the sale in your books. The invoice number cannot be e-invoiced again.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={!cancelForm.remark.trim() || cancel.isPending} onClick={() => cancel.mutate()}>
                {cancel.isPending ? 'Cancelling…' : 'Cancel IRN and reverse sale'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setCancelling(false)}>Keep it</Button>
            </div>
            {cancel.isError && <p className="text-caption text-error-fg">{message(cancel.error)}</p>}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 text-caption font-semibold uppercase tracking-wide text-ink-500">E-way bill</p>
        {activeEwb ? (
          <div className="rounded-md bg-success-bg p-2 text-caption text-success-fg">
            <p className="font-mono font-medium">EWB {activeEwb.ewbNo}{activeEwb.isTest ? ' (test)' : ''}</p>
            <p>Valid until {when(activeEwb.validUpto)} · {activeEwb.distanceKm} km by {activeEwb.mode}{activeEwb.vehicleNo ? ` · ${activeEwb.vehicleNo}` : ''}</p>
            <button
              type="button"
              className="mt-1 text-caption text-error-fg hover:underline disabled:opacity-50"
              disabled={cancelEwb.isPending}
              onClick={() => window.confirm('Cancel this e-way bill? It can only be done within 24 hours of making it.') && cancelEwb.mutate(activeEwb._id)}
            >
              Cancel e-way bill
            </button>
            {cancelEwb.isError && <p className="text-error-fg">{message(cancelEwb.error)}</p>}
          </div>
        ) : !ewbOpen ? (
          <>
            <p className="mb-1 text-caption text-ink-500">{data.ewbRequired ? 'Goods worth over ₹50,000 need an e-way bill to move.' : 'Under ₹50,000: not required, but you can make one.'}</p>
            <Button size="sm" variant="secondary" onClick={() => setEwbOpen(true)}>Make e-way bill</Button>
          </>
        ) : (
          <div className="space-y-2 rounded-md border border-line-200 p-2">
            {s && (
              <button
                type="button"
                className="w-full rounded-md bg-pending-bg p-2 text-left text-caption text-pending-fg"
                onClick={() =>
                  setEwb((f) => ({
                    ...f,
                    mode: s.mode,
                    vehicleNo: s.vehicleNo ?? f.vehicleNo,
                    transporterId: s.transporterId ?? f.transporterId,
                    transporterName: s.transporterName ?? f.transporterName,
                    distanceKm: s.distanceKm ? String(s.distanceKm) : f.distanceKm,
                  }))
                }
              >
                Use the same as {s.basis}: {[s.vehicleNo, s.transporterName, s.distanceKm ? `${s.distanceKm} km` : null].filter(Boolean).join(' · ')}
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input className={field} inputMode="numeric" placeholder="Distance (km)" value={ewb.distanceKm} onChange={(ev) => setEwb((f) => ({ ...f, distanceKm: ev.target.value.replace(/\D/g, '') }))} />
              <select className={field} value={ewb.mode} onChange={(ev) => setEwb((f) => ({ ...f, mode: ev.target.value as EwayBill['mode'] }))}>
                <option value="road">Road</option>
                <option value="rail">Rail</option>
                <option value="air">Air</option>
                <option value="ship">Ship</option>
              </select>
              {ewb.mode === 'road' ? (
                <input className={`${field} font-mono`} placeholder="Vehicle no." value={ewb.vehicleNo} onChange={(ev) => setEwb((f) => ({ ...f, vehicleNo: ev.target.value }))} />
              ) : (
                <input className={field} placeholder="RR / airway bill / B/L no." value={ewb.transDocNo} onChange={(ev) => setEwb((f) => ({ ...f, transDocNo: ev.target.value }))} />
              )}
              {ewb.mode === 'road' ? (
                <input className={`${field} font-mono`} placeholder="Transporter ID (optional)" value={ewb.transporterId} onChange={(ev) => setEwb((f) => ({ ...f, transporterId: ev.target.value }))} />
              ) : (
                <input className={field} type="date" value={ewb.transDocDate} onChange={(ev) => setEwb((f) => ({ ...f, transDocDate: ev.target.value }))} />
              )}
              <input className={`${field} col-span-2`} placeholder="Transporter name (optional)" value={ewb.transporterName} onChange={(ev) => setEwb((f) => ({ ...f, transporterName: ev.target.value }))} />
            </div>
            <p className="text-[0.7rem] text-ink-500">Distance is yours to enter: the road distance from your pincode to the customer&apos;s.</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={!ewb.distanceKm || makeEwb.isPending} onClick={() => makeEwb.mutate()}>
                {makeEwb.isPending ? 'Generating…' : 'Generate e-way bill'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEwbOpen(false)}>Cancel</Button>
            </div>
            {makeEwb.isError && <p className="text-caption text-error-fg">{message(makeEwb.error)}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
