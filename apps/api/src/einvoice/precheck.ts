import { gstinProblem } from '../extraction/invoice-checks';
import { EinvoiceInput, lineShares } from './einvoice-payload';

/**
 * What the IRP would reject, found before the invoice is sent, each with
 * the fix and where to make it. Rules taken from the e-invoice schema and
 * its validations; a pass here is not a promise the IRP accepts, but most
 * rejections are one of these.
 */

export interface PrecheckIssue {
  level: 'block' | 'warn';
  code: string;
  where: 'settings' | 'customer' | 'invoice' | 'item';
  message: string;
  fix: string;
}

/** The first digit of PIN codes in each state, by GST state code. Others are not checked. */
const PIN_ZONES: Record<string, string> = {
  '01': '1', '02': '1', '03': '1', '04': '1', '06': '1', '07': '1', '38': '1',
  '05': '2', '09': '2',
  '08': '3', '24': '3', '26': '3',
  '22': '4', '23': '4', '27': '4', '30': '4',
  '28': '5', '29': '5', '36': '5', '37': '5',
  '31': '6', '32': '6', '33': '6', '34': '6',
  '11': '7', '12': '7', '13': '7', '14': '7', '15': '7', '16': '7', '17': '7', '18': '7', '19': '7', '21': '7', '35': '7',
  '10': '8', '20': '8',
};

/** The IRP's pattern for a document number: up to 16, starting with a letter or 1–9. */
const DOC_NO = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/;

export function precheck(input: EinvoiceInput, today: string): PrecheckIssue[] {
  const out: PrecheckIssue[] = [];
  const block = (code: string, where: PrecheckIssue['where'], message: string, fix: string) => out.push({ level: 'block', code, where, message, fix });
  const warn = (code: string, where: PrecheckIssue['where'], message: string, fix: string) => out.push({ level: 'warn', code, where, message, fix });

  // Who: both sides, as registered.
  const s = input.seller;
  const sellerProblem = s.gstin ? gstinProblem(s.gstin) : 'is missing';
  if (sellerProblem) block('seller_gstin', 'settings', `Your GSTIN ${s.gstin ?? ''} ${sellerProblem}.`.replace('  ', ' '), 'Enter your GSTIN in Settings → Business.');
  if (!input.buyer.gstin) {
    block('b2c', 'customer', `${input.buyer.legalName} has no GSTIN, so this is a B2C sale: e-invoices are only for registered buyers.`, 'No IRN is needed. If the customer is registered, add their GSTIN.');
    return out;
  }
  const buyerProblem = gstinProblem(input.buyer.gstin);
  if (buyerProblem) block('buyer_gstin', 'customer', `The customer's GSTIN ${input.buyer.gstin} ${buyerProblem}.`, `Correct the GSTIN on ${input.buyer.legalName}.`);

  for (const [who, p, where] of [['Your business', s, 'settings'], [input.buyer.legalName, input.buyer, 'customer']] as const) {
    const at = where === 'settings' ? 'in Settings → Business' : `on ${input.buyer.legalName}`;
    if (p.legalName.trim().length < 3) block(`${where}_name`, where, `${who}: the legal name must be at least 3 characters.`, `Enter the full legal name ${at}.`);
    if (!p.address?.trim()) block(`${where}_address`, where, `${who} has no address.`, `Add the address ${at}.`);
    if ((p.city ?? '').trim().length < 3) block(`${where}_city`, where, `${who} has no city (the IRP calls it location).`, `Add the city ${at}.`);
    if (!/^[1-9]\d{5}$/.test(p.pincode ?? '')) {
      block(`${where}_pincode`, where, `${who} has no valid pincode.`, `Add the six-digit pincode ${at}.`);
    } else if (p.stateCode && PIN_ZONES[p.stateCode] && p.pincode![0] !== PIN_ZONES[p.stateCode]) {
      warn(`${where}_pincode_state`, where, `${who}: pincode ${p.pincode} is not in state ${p.stateCode}'s range (those start with ${PIN_ZONES[p.stateCode]}).`, `Check the pincode ${at}; the IRP refuses a pincode outside the state.`);
    }
  }

  // Where: the tax charged must follow the place of supply.
  const pos = input.placeOfSupply ?? input.buyer.stateCode;
  const sellerState = s.gstin?.slice(0, 2) ?? s.stateCode;
  const a = input.amounts;
  if (pos && sellerState && a.cgst + a.sgst + a.igst > 0) {
    if (pos !== sellerState && a.cgst + a.sgst > 0) block('pos_tax', 'invoice', `The place of supply is state ${pos}, outside your state ${sellerState}, but the invoice charges CGST and SGST.`, 'An inter-state sale carries IGST. Reverse the invoice and raise it again with IGST.');
    if (pos === sellerState && a.igst > 0) block('pos_tax', 'invoice', `The place of supply is your own state ${pos}, but the invoice charges IGST.`, 'A sale within the state carries CGST and SGST. Reverse the invoice and raise it again.');
  }

  // What: the document and its lines.
  if (!input.number) block('doc_no', 'invoice', 'The invoice has no number.', 'Post it to give it the next number.');
  else if (!DOC_NO.test(input.number)) block('doc_no', 'invoice', `Invoice number "${input.number}" is not one the IRP takes: up to 16 letters, digits, / or -, not starting with 0, / or -.`, 'Change the numbering series in Settings before the next invoice; this one needs a credit note and a new invoice.');
  if (input.date > today) block('doc_date', 'invoice', `The invoice is dated ${input.date}, in the future.`, 'The IRP only takes invoices dated today or earlier.');
  else if (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${input.date}T00:00:00Z`) > 30 * 86_400_000) {
    warn('doc_age', 'invoice', `The invoice is over 30 days old.`, 'If your turnover is ₹10 crore or more, the IRP refuses invoices older than 30 days; below that it is accepted.');
  }
  if (input.lines.length === 0) block('no_lines', 'invoice', 'The invoice has no lines, and the IRP needs each item with its HSN.', 'Raise invoices with their lines to e-invoice them.');
  input.lines.forEach((l, i) => {
    const label = `Line ${i + 1} (${l.description.slice(0, 40)})`;
    const hsn = (l.hsnSac ?? '').replace(/\s/g, '');
    if (!hsn) block('hsn_missing', 'item', `${label} has no HSN/SAC code.`, 'Pick an item that has one, or add the code to the line.');
    else if (!/^\d{4}(\d{2}(\d{2})?)?$/.test(hsn)) block('hsn_format', 'item', `${label}: "${hsn}" is not a 4, 6 or 8 digit HSN/SAC code.`, 'Correct the code on the item.');
    else if (hsn.length === 4 && !hsn.startsWith('99')) warn('hsn_short', 'item', `${label}: a 4-digit HSN.`, 'Above ₹5 crore turnover the IRP needs 6 digits.');
  });
  const lineTotal = input.lines.reduce((sum, l) => sum + l.amountPaise, 0);
  if (input.lines.length && Math.abs(lineTotal - a.taxableValue) > 100) {
    warn('line_total', 'invoice', `The lines add up to ₹${(lineTotal / 100).toFixed(2)}, the taxable value is ₹${(a.taxableValue / 100).toFixed(2)}.`, 'Each line is sent at its share of the taxable value, so the lines add up; check the lines are right.');
  }
  const shares = lineShares(input);
  shares.lines.forEach((l, i) => {
    const tax = shares.igst[i] + shares.cgst[i] + shares.sgst[i];
    const expected = Math.round((shares.txval[i] * (l.taxRatePct || 0)) / 100);
    if (Math.abs(tax - expected) > Math.max(100, expected / 100)) {
      warn('line_tax', 'invoice', `Line ${i + 1}: tax of ₹${(tax / 100).toFixed(2)} is not ${l.taxRatePct}% of ₹${(shares.txval[i] / 100).toFixed(2)}.`, 'The IRP checks tax against the rate on each line. Check the rate.');
    }
  });
  return out;
}
