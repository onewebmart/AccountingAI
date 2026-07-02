'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Step1Data {
  orgName: string;
  gstin: string;
  pan: string;
  state: string;
}

interface Step2Data {
  financialYearStart: number;
  timezone: string;
}

interface Step3Data {
  inviteEmail: string;
  inviteRole: string;
}

// ── Stepper indicator ─────────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center gap-2">
            <div
              className={`h-3 w-3 rounded-full transition-all ${
                done
                  ? 'bg-marigold-400'
                  : active
                  ? 'bg-marigold-400 ring-4 ring-marigold-400/30'
                  : 'border-2 border-marigold-400 bg-transparent'
              }`}
            >
              {done && <Check className="hidden" size={8} />}
            </div>
            {i < total - 1 && (
              <div className={`h-px w-8 transition-colors ${done ? 'bg-marigold-400' : 'bg-line-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Business info ─────────────────────────────────────────────────────

function Step1({
  data,
  onChange,
}: {
  data: Step1Data;
  onChange: (d: Partial<Step1Data>) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
          Tell us about your business
        </h2>
        <p className="text-body text-ink-500 mt-1">
          This appears on your invoices, reports, and GST filings.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">
            Business name <span className="text-[#C92A2A]">*</span>
          </label>
          <input
            type="text"
            value={data.orgName}
            onChange={(e) => onChange({ orgName: e.target.value })}
            placeholder="Acme Traders Pvt. Ltd."
            autoFocus
            className="w-full rounded-md border border-line-200 bg-white px-3 py-2.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400/40 focus:border-marigold-400"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-caption font-medium text-ink-700 mb-1">GSTIN <span className="text-ink-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={data.gstin}
              onChange={(e) => onChange({ gstin: e.target.value.toUpperCase() })}
              placeholder="27AAPFU0939F1ZV"
              maxLength={15}
              className="w-full rounded-md border border-line-200 bg-white px-3 py-2.5 font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400/40 focus:border-marigold-400"
            />
          </div>
          <div>
            <label className="block text-caption font-medium text-ink-700 mb-1">PAN</label>
            <input
              type="text"
              value={data.pan}
              onChange={(e) => onChange({ pan: e.target.value.toUpperCase() })}
              placeholder="AAPFU0939F"
              maxLength={10}
              className="w-full rounded-md border border-line-200 bg-white px-3 py-2.5 font-mono text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400/40 focus:border-marigold-400"
            />
          </div>
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">State</label>
          <select
            value={data.state}
            onChange={(e) => onChange({ state: e.target.value })}
            className="w-full rounded-md border border-line-200 bg-white px-3 py-2.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400/40 focus:border-marigold-400"
          >
            <option value="">Select a state…</option>
            <option value="27">27 — Maharashtra</option>
            <option value="07">07 — Delhi</option>
            <option value="29">29 — Karnataka</option>
            <option value="33">33 — Tamil Nadu</option>
            <option value="09">09 — Uttar Pradesh</option>
            <option value="06">06 — Haryana</option>
            <option value="24">24 — Gujarat</option>
            <option value="19">19 — West Bengal</option>
            <option value="36">36 — Telangana</option>
            <option value="32">32 — Kerala</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Financial year ─────────────────────────────────────────────────────

function Step2({
  data,
  onChange,
}: {
  data: Step2Data;
  onChange: (d: Partial<Step2Data>) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
          Set your financial year
        </h2>
        <p className="text-body text-ink-500 mt-1">
          Most Indian businesses use April–March. You can change this later.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Financial year start</label>
          <select
            value={data.financialYearStart}
            onChange={(e) => onChange({ financialYearStart: Number(e.target.value) })}
            className="w-full rounded-md border border-line-200 bg-white px-3 py-2.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400/40 focus:border-marigold-400"
          >
            <option value={4}>April (Indian FY — recommended)</option>
            <option value={1}>January (Calendar year)</option>
            <option value={7}>July</option>
            <option value={10}>October</option>
          </select>
          <p className="text-caption text-ink-400 mt-1">
            Indian FY runs April to March (e.g. FY 2025–26).
          </p>
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Currency</label>
          <div className="rounded-md border border-line-200 bg-surface-sink px-3 py-2.5 text-body text-ink-700">
            INR — Indian Rupee
          </div>
          <p className="text-caption text-ink-400 mt-1">Multi-currency support is coming soon.</p>
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Timezone</label>
          <select
            value={data.timezone}
            onChange={(e) => onChange({ timezone: e.target.value })}
            className="w-full rounded-md border border-line-200 bg-white px-3 py-2.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400/40 focus:border-marigold-400"
          >
            <option value="Asia/Kolkata">Asia/Kolkata — IST (UTC+5:30)</option>
            <option value="Asia/Dubai">Asia/Dubai — GST (UTC+4)</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Invite team ────────────────────────────────────────────────────────

function Step3({
  data,
  onChange,
}: {
  data: Step3Data;
  onChange: (d: Partial<Step3Data>) => void;
}) {
  const ROLE_LABELS: Record<string, string> = {
    COMPANY_ADMIN: 'Company admin',
    ACCOUNTANT: 'Accountant',
    CA_REVIEWER: 'CA reviewer',
    EMPLOYEE: 'Employee',
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
          Invite your team
        </h2>
        <p className="text-body text-ink-500 mt-1">
          You can invite more people later from Settings → Team.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Email address</label>
          <input
            type="email"
            value={data.inviteEmail}
            onChange={(e) => onChange({ inviteEmail: e.target.value })}
            placeholder="colleague@yourcompany.com"
            className="w-full rounded-md border border-line-200 bg-white px-3 py-2.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400/40 focus:border-marigold-400"
          />
        </div>

        <div>
          <label className="block text-caption font-medium text-ink-700 mb-1">Role</label>
          <select
            value={data.inviteRole}
            onChange={(e) => onChange({ inviteRole: e.target.value })}
            className="w-full rounded-md border border-line-200 bg-white px-3 py-2.5 text-body text-ink-900 focus:outline-none focus:ring-2 focus:ring-marigold-400/40 focus:border-marigold-400"
          >
            {Object.entries(ROLE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border border-line-200 bg-surface-sink p-4 text-caption text-ink-500">
          <p className="font-medium text-ink-700 mb-1">Role guide</p>
          <ul className="space-y-1">
            <li><span className="font-medium text-ink-700">Company admin</span> — full access including settings</li>
            <li><span className="font-medium text-ink-700">Accountant</span> — can post entries and view reports</li>
            <li><span className="font-medium text-ink-700">CA reviewer</span> — review-only, no posting</li>
            <li><span className="font-medium text-ink-700">Employee</span> — upload documents, view reports</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [step1, setStep1] = useState<Step1Data>({ orgName: '', gstin: '', pan: '', state: '' });
  const [step2, setStep2] = useState<Step2Data>({ financialYearStart: 4, timezone: 'Asia/Kolkata' });
  const [step3, setStep3] = useState<Step3Data>({ inviteEmail: '', inviteRole: 'ACCOUNTANT' });

  const TOTAL_STEPS = 3;

  const patchMutation = useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: (body: Record<string, any>) => api.patch('/settings', body),
  });

  const inviteMutation = useMutation({
    mutationFn: (body: { email: string; role: string }) =>
      api.post('/settings/team', body),
  });

  const handleNext = async () => {
    if (step === 0) {
      // Save step 1
      await patchMutation.mutateAsync({
        orgName: step1.orgName,
        gstin: step1.gstin || undefined,
        pan: step1.pan || undefined,
        state: step1.state || undefined,
      }).catch(() => {/* silently proceed on API error — mock env */});
      setStep(1);
    } else if (step === 1) {
      // Save step 2
      await patchMutation.mutateAsync({
        financialYearStart: step2.financialYearStart,
        timezone: step2.timezone,
      }).catch(() => {});
      setStep(2);
    } else if (step === 2) {
      // Invite + finish
      if (step3.inviteEmail) {
        await inviteMutation.mutateAsync({
          email: step3.inviteEmail,
          role: step3.inviteRole,
        }).catch(() => {});
      }
      router.push('/dashboard');
    }
  };

  const handleSkip = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
    } else {
      router.push('/dashboard');
    }
  };

  const isLoading = patchMutation.isPending || inviteMutation.isPending;

  const canProceed = () => {
    if (step === 0) return step1.orgName.trim().length > 0;
    return true;
  };

  return (
    <div className="min-h-screen bg-[#FFFCF6] flex flex-col items-center justify-center p-6">
      {/* Brand */}
      <div className="mb-10 text-center">
        <span className="text-h2 font-display text-ink-900" style={{ fontFamily: 'var(--font-display)' }}>
          ◆{' '}
          <span className="text-marigold-400">Ai</span>
          <span className="text-ink-900">Books</span>
        </span>
      </div>

      {/* Card */}
      <div className="w-full max-w-lg rounded-2xl border border-line-200 bg-white shadow-sm">
        {/* Progress bar */}
        <div className="flex gap-0">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 first:rounded-tl-2xl last:rounded-tr-2xl transition-colors ${
                i <= step ? 'bg-marigold-400' : 'bg-line-200'
              }`}
            />
          ))}
        </div>

        <div className="p-8">
          {/* Step dots */}
          <div className="flex items-center justify-between mb-8">
            <StepDots current={step} total={TOTAL_STEPS} />
            <span className="text-caption text-ink-400">
              Step {step + 1} of {TOTAL_STEPS}
            </span>
          </div>

          {/* Step content */}
          {step === 0 && (
            <Step1 data={step1} onChange={(d) => setStep1((s) => ({ ...s, ...d }))} />
          )}
          {step === 1 && (
            <Step2 data={step2} onChange={(d) => setStep2((s) => ({ ...s, ...d }))} />
          )}
          {step === 2 && (
            <Step3 data={step3} onChange={(d) => setStep3((s) => ({ ...s, ...d }))} />
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-line-200">
            {step === TOTAL_STEPS - 1 ? (
              <button
                onClick={handleSkip}
                className="text-body text-ink-400 hover:text-ink-700 transition-colors"
              >
                Skip for now
              </button>
            ) : (
              <div />
            )}

            <Button
              onClick={handleNext}
              disabled={!canProceed() || isLoading}
              className="flex items-center gap-2 min-w-[160px] justify-center"
            >
              {isLoading ? (
                'Saving…'
              ) : step === TOTAL_STEPS - 1 ? (
                'Go to dashboard'
              ) : (
                <>Next <ChevronRight size={14} /></>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Step label */}
      <div className="mt-6 text-center">
        <p className="text-caption text-ink-400">
          {step === 0 && 'Your business details are used on invoices and GST filings.'}
          {step === 1 && 'Financial year and timezone affect reports and document dating.'}
          {step === 2 && 'Invite team members to collaborate. You can skip this for now.'}
        </p>
      </div>
    </div>
  );
}
