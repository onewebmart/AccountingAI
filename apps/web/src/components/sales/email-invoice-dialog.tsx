'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, ApiError } from '@/lib/api';

/**
 * Email an invoice's PDF to the customer. The customer's own address is
 * filled in; the server refuses, and says why, when there is no number yet,
 * no address, or no mail server.
 */
export function EmailInvoiceDialog({
  invoice,
  customerEmail,
  onClose,
  onSent,
}: {
  invoice: { _id: string; invoiceNumber: string | null; customerName: string } | null;
  customerEmail: string | null;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [to, setTo] = useState<string | null>(null);
  const [cc, setCc] = useState('');
  const [message, setMessage] = useState('');
  const address = to ?? customerEmail ?? '';

  const send = useMutation({
    mutationFn: () =>
      api.post<{ emailedTo: string }>(`/sales/invoices/${invoice!._id}/email`, {
        to: address.trim() || undefined,
        cc: cc.split(/[,;\s]+/).filter(Boolean),
        message: message.trim() || undefined,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['sales'] });
      onSent(`Invoice emailed to ${res.emailedTo}`);
      close();
    },
  });

  const close = () => {
    setTo(null);
    setCc('');
    setMessage('');
    send.reset();
    onClose();
  };
  const field = 'w-full rounded-md border border-line-200 bg-white px-3 py-2 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-saffron-600/40';

  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Email invoice {invoice?.invoiceNumber ?? ''}</DialogTitle>
          <DialogDescription>To {invoice?.customerName}, with the PDF attached.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-700">To</span>
            <input type="email" className={field} value={address} onChange={(e) => setTo(e.target.value)} required />
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-700">Cc</span>
            <input className={field} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional, separated by commas" />
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-ink-700">Message</span>
            <textarea className={field} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="optional, above the standard wording" />
          </label>
          {send.isError && (
            <p className="text-caption text-error-fg">
              {send.error instanceof ApiError && send.error.message ? send.error.message : "Couldn't email the invoice."}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={send.isPending || !address.trim()}>
              {send.isPending ? 'Sending…' : 'Email invoice'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
