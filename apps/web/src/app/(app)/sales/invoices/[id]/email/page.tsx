'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-error';
import { PageHeader, FormPage, Section, Field, inputClass } from '@/components/page/page-shell';
import { notify } from '@/components/page/notifier';
import { api } from '@/lib/api';
import { errorText, type CustomerRecord, type InvoiceRecord } from '@/components/sales/sales-data';

/**
 * Email an invoice's PDF to the customer. Their address is filled in; the
 * server refuses, and says why, when there is no number yet, no address, or
 * no mail server.
 */
function EmailForm({ invoice, customer }: { invoice: InvoiceRecord; customer: CustomerRecord | undefined }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [to, setTo] = useState(customer?.email ?? '');
  const [cc, setCc] = useState('');
  const [message, setMessage] = useState('');

  const send = useMutation({
    mutationFn: () =>
      api.post<{ emailedTo: string }>(`/sales/invoices/${invoice._id}/email`, {
        to: to.trim() || undefined,
        cc: cc.split(/[,;\s]+/).filter(Boolean),
        message: message.trim() || undefined,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      notify(`Invoice emailed to ${res.emailedTo}`);
      router.push(`/sales/invoices/${invoice._id}`);
    },
  });

  return (
    <FormPage
      onSubmit={() => send.mutate()}
      error={send.isError ? errorText(send.error, "Couldn't email the invoice.") : null}
      actions={
        <>
          <Button type="submit" disabled={send.isPending || !to.trim()}>{send.isPending ? 'Sending…' : 'Email invoice'}</Button>
          <Button asChild variant="secondary"><Link href={`/sales/invoices/${invoice._id}`}>Cancel</Link></Button>
        </>
      }
    >
      <Section title="The email" description="The invoice PDF goes as an attachment, under the standard wording.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="To" required>
            <input type="email" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Cc" hint="Optional, separated by commas.">
            <input className={inputClass} value={cc} onChange={(e) => setCc(e.target.value)} />
          </Field>
          <Field label="Message" className="md:col-span-2" hint="Optional, above the standard wording.">
            <textarea className={inputClass} rows={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
        </div>
      </Section>
    </FormPage>
  );
}

export default function EmailInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const invoice = useQuery({ queryKey: ['sales', 'invoice', id], queryFn: () => api.get<InvoiceRecord>(`/sales/invoices/${id}`) });
  const customerId = invoice.data?.customerId;
  const customer = useQuery({
    queryKey: ['sales', 'customer', customerId],
    queryFn: () => api.get<CustomerRecord>(`/sales/customers/${customerId}`),
    enabled: !!customerId,
  });
  const inv = invoice.data;
  const ready = !!inv && (customer.isSuccess || customer.isError);

  return (
    <div>
      <PageHeader
        title="Email invoice"
        subtitle={inv ? <>Invoice <span className="font-mono">{inv.invoiceNumber ?? '(not numbered)'}</span>{customer.data ? ` to ${inv.partyAtIssue?.name ?? customer.data.name}` : ''}</> : undefined}
        back={{ href: `/sales/invoices/${id}`, label: inv?.invoiceNumber ? `Invoice ${inv.invoiceNumber}` : 'Invoice' }}
      />
      {invoice.isError && <QueryError error={invoice.error} onRetry={() => void invoice.refetch()} />}
      {!ready && !invoice.isError && <p className="text-caption text-ink-400">Loading…</p>}
      {inv && ready && <EmailForm key={inv._id} invoice={inv} customer={customer.data} />}
    </div>
  );
}
