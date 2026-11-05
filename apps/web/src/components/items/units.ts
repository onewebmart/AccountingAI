/**
 * GST's unit quantity codes (UQC) with a plain name each, as the item form
 * lists them: "KGS - kilogram". The codes are the API's (UQC_CODES in
 * apps/api/src/items/hsn.ts) less NA, which is a service's and not picked.
 */
export const UNITS: Array<{ code: string; name: string }> = [
  { code: 'BAG', name: 'bag' },
  { code: 'BAL', name: 'bale' },
  { code: 'BDL', name: 'bundle' },
  { code: 'BKL', name: 'buckle' },
  { code: 'BOU', name: 'billion units' },
  { code: 'BOX', name: 'box' },
  { code: 'BTL', name: 'bottle' },
  { code: 'BUN', name: 'bunch' },
  { code: 'CAN', name: 'can' },
  { code: 'CBM', name: 'cubic metre' },
  { code: 'CCM', name: 'cubic centimetre' },
  { code: 'CMS', name: 'centimetre' },
  { code: 'CTN', name: 'carton' },
  { code: 'DOZ', name: 'dozen' },
  { code: 'DRM', name: 'drum' },
  { code: 'GGK', name: 'great gross' },
  { code: 'GMS', name: 'gram' },
  { code: 'GRS', name: 'gross' },
  { code: 'GYD', name: 'gross yard' },
  { code: 'KGS', name: 'kilogram' },
  { code: 'KLR', name: 'kilolitre' },
  { code: 'KME', name: 'kilometre' },
  { code: 'LTR', name: 'litre' },
  { code: 'MLT', name: 'millilitre' },
  { code: 'MTR', name: 'metre' },
  { code: 'MTS', name: 'metric tonne' },
  { code: 'NOS', name: 'numbers' },
  { code: 'OTH', name: 'others' },
  { code: 'PAC', name: 'pack' },
  { code: 'PCS', name: 'pieces' },
  { code: 'PRS', name: 'pairs' },
  { code: 'QTL', name: 'quintal' },
  { code: 'ROL', name: 'roll' },
  { code: 'SET', name: 'set' },
  { code: 'SQF', name: 'square foot' },
  { code: 'SQM', name: 'square metre' },
  { code: 'SQY', name: 'square yard' },
  { code: 'TBS', name: 'tablets' },
  { code: 'TGM', name: 'ten gross' },
  { code: 'THD', name: 'thousands' },
  { code: 'TON', name: 'tonne' },
  { code: 'TUB', name: 'tube' },
  { code: 'UGS', name: 'US gallon' },
  { code: 'UNT', name: 'units' },
  { code: 'YDS', name: 'yard' },
];

/** "KGS - kilogram"; a code we do not list shows as itself. */
export function unitLabel(code: string): string {
  const u = UNITS.find((x) => x.code === code);
  return u ? `${u.code} - ${u.name}` : code;
}
