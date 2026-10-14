/**
 * GST arithmetic, in integer paise throughout (Invariant 1).
 *
 * Both the sales and purchase screens need the same split, and the API takes
 * the breakdown as given rather than computing it — so the one place it is
 * worked out is here, not twice in two modals that could drift apart.
 */

export const GST_RATES = [0, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];

export interface AmountsPaise {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

/**
 * Splits a taxable value at the given rate.
 *
 * `interState` decides IGST versus CGST+SGST: a supply crossing a state border
 * carries one integrated tax, one within a state carries two halves. Getting
 * this wrong does not change what the customer pays, but it files under the
 * wrong heads and the return will not reconcile.
 *
 * The intra-state halves are rounded independently and IGST is taken as the
 * whole, so cgst + sgst can differ from igst by a paisa at odd rates. That is
 * the same rounding the portal applies; the total is always the sum of the
 * parts actually stored, never recomputed.
 */
export function splitGst(
  taxableValuePaise: number,
  rate: GstRate,
  interState = false,
): AmountsPaise {
  const taxableValue = Math.round(taxableValuePaise);
  const tax = Math.round((taxableValue * rate) / 100);

  if (interState) {
    return {
      taxableValue,
      cgst: 0,
      sgst: 0,
      igst: tax,
      cess: 0,
      total: taxableValue + tax,
    };
  }

  const half = Math.round(tax / 2);
  // The second half absorbs the odd paisa so the two always sum to the tax.
  const other = tax - half;
  return {
    taxableValue,
    cgst: half,
    sgst: other,
    igst: 0,
    cess: 0,
    total: taxableValue + half + other,
  };
}

/** Rupees typed by a person → integer paise. Returns null for anything unusable. */
export function rupeesToPaise(value: string): number | null {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function formatPaise(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

/**
 * GST state codes — the first two digits of every GSTIN. The settings and
 * onboarding pickers listed seven to eleven states, so a business elsewhere
 * could not record where it is registered.
 */
export const GST_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
];
