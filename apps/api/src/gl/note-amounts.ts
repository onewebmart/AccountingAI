import { BadRequestException } from '@nestjs/common';

export interface TaxSplit {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

const TAX_HEADS = ['cgst', 'sgst', 'igst', 'cess'] as const;

export const ZERO_SPLIT: TaxSplit = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };

/** Component-wise sum, e.g. of the notes already raised against a document. */
export function addSplits(splits: TaxSplit[]): TaxSplit {
  return splits.reduce(
    (acc, s) => ({
      taxableValue: acc.taxableValue + s.taxableValue,
      cgst: acc.cgst + s.cgst,
      sgst: acc.sgst + s.sgst,
      igst: acc.igst + s.igst,
      cess: acc.cess + s.cess,
      total: acc.total + s.total,
    }),
    ZERO_SPLIT,
  );
}

/**
 * The amounts of a credit or debit note that reduces a document's taxable
 * value by `taxablePaise`.
 *
 * Each tax head moves in the same proportion as on the original, so a note
 * cannot change the effective rate. Noting everything that remains uses
 * exactly what remains, so rounding across several notes cannot leave a
 * stray paisa of tax behind or take one too many. The note's total is the sum
 * of its parts.
 */
export function noteAmounts(original: TaxSplit, alreadyNoted: TaxSplit, taxablePaise: number): TaxSplit {
  const remaining: TaxSplit = {
    taxableValue: original.taxableValue - alreadyNoted.taxableValue,
    cgst: original.cgst - alreadyNoted.cgst,
    sgst: original.sgst - alreadyNoted.sgst,
    igst: original.igst - alreadyNoted.igst,
    cess: original.cess - alreadyNoted.cess,
    total: 0,
  };

  if (!Number.isInteger(taxablePaise) || taxablePaise <= 0) {
    throw new BadRequestException('The taxable amount must be a positive whole number of paise');
  }
  if (taxablePaise > remaining.taxableValue) {
    throw new BadRequestException(
      `Only ${rupees(remaining.taxableValue)} of taxable value is left to adjust on this document`,
    );
  }

  const split: TaxSplit =
    taxablePaise === remaining.taxableValue
      ? remaining
      : {
          taxableValue: taxablePaise,
          ...Object.fromEntries(
            TAX_HEADS.map((head) => [
              head,
              original.taxableValue > 0
                ? Math.min(remaining[head], Math.round((taxablePaise * original[head]) / original.taxableValue))
                : 0,
            ]),
          ),
          total: 0,
        } as TaxSplit;

  return { ...split, total: split.taxableValue + split.cgst + split.sgst + split.igst + split.cess };
}

export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
