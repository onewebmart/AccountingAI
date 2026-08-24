'use client';

import { useEffect, useState } from 'react';
import { ClientType, FirmService } from '@ai-accounting/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CLIENT_TYPE_LABELS, SERVICE_LABELS } from '@/lib/crm-labels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: Record<string, unknown>) => void;
  submitting: boolean;
  error: Error | null;
}

const EMPTY = {
  name: '',
  clientType: '' as ClientType | '',
  pan: '',
  gstin: '',
  whatsappNumber: '',
  contactEmail: '',
  contactName: '',
};

export function AddClientDialog({ open, onOpenChange, onSubmit, submitting, error }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [services, setServices] = useState<FirmService[]>([]);

  // Reset whenever the dialog is reopened, so a previous attempt doesn't linger.
  useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setServices([]);
    }
  }, [open]);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleService(s: FirmService) {
    setServices((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Send only what was filled in — the API rejects empty strings on
    // pattern-validated fields like GSTIN and PAN.
    const payload: Record<string, unknown> = { name: form.name.trim() };
    if (form.clientType) payload.clientType = form.clientType;
    if (form.pan.trim()) payload.pan = form.pan.trim().toUpperCase();
    if (form.gstin.trim()) payload.gstin = form.gstin.trim().toUpperCase();
    if (form.whatsappNumber.trim()) payload.whatsappNumber = form.whatsappNumber.replace(/\D/g, '');
    if (form.contactEmail.trim()) payload.contactEmail = form.contactEmail.trim();
    if (form.contactName.trim()) payload.contactName = form.contactName.trim();
    if (services.length) payload.services = services;
    onSubmit(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-heading">Add client</DialogTitle>
          <DialogDescription>
            Services decide which statutory deadlines and document checklists this client gets.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">
              Client / firm name <span className="text-[#C92A2A]">*</span>
            </Label>
            <Input
              id="name"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Mehta Textiles Pvt Ltd"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="clientType">Client type</Label>
              <Select
                value={form.clientType || undefined}
                onValueChange={(v) => set('clientType', v as ClientType)}
              >
                <SelectTrigger id="clientType">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(ClientType).map((t) => (
                    <SelectItem key={t} value={t}>
                      {CLIENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactName">Contact person</Label>
              <Input
                id="contactName"
                value={form.contactName}
                onChange={(e) => set('contactName', e.target.value)}
                placeholder="Ramesh Mehta"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pan">PAN</Label>
              <Input
                id="pan"
                value={form.pan}
                onChange={(e) => set('pan', e.target.value.toUpperCase())}
                placeholder="ABCPS1234D"
                className="font-mono"
                maxLength={10}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gstin">GSTIN</Label>
              <Input
                id="gstin"
                value={form.gstin}
                onChange={(e) => set('gstin', e.target.value.toUpperCase())}
                placeholder="23AABCM1234F1Z5"
                className="font-mono"
                maxLength={15}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="whatsappNumber">WhatsApp number</Label>
              <Input
                id="whatsappNumber"
                inputMode="numeric"
                value={form.whatsappNumber}
                onChange={(e) => set('whatsappNumber', e.target.value)}
                placeholder="9876543210"
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactEmail">Email</Label>
              <Input
                id="contactEmail"
                type="email"
                value={form.contactEmail}
                onChange={(e) => set('contactEmail', e.target.value)}
                placeholder="ramesh@mehtatextiles.in"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Services required</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.values(FirmService).map((s) => (
                <label
                  key={s}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-line-200 px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-surface-sink"
                >
                  <Checkbox
                    checked={services.includes(s)}
                    onCheckedChange={() => toggleService(s)}
                  />
                  {SERVICE_LABELS[s]}
                </label>
              ))}
            </div>
          </div>

          {error ? (
            <p className="rounded-lg bg-[#C92A2A]/5 px-3 py-2 text-sm text-[#C92A2A]">
              {error.message}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !form.name.trim()}>
              {submitting ? 'Adding…' : 'Add client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
