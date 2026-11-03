import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { TDS_SECTION_CODES } from '../../gl/tds';
import { AmountsPaiseDto, LineItemDto } from '../../sales/dto/sales.dto';

/**
 * Bodies for POST /api/v1/purchase/*.
 *
 * Same reasoning as the sales DTOs: the controller typed its body as a
 * TypeScript type, which is erased at runtime, so ValidationPipe had nothing to
 * check and a wrong shape became a 500 instead of a 400 naming the field.
 *
 * The money and line-item shapes are shared with sales rather than duplicated —
 * a bill and an invoice carry the same tax breakdown, and two copies is two
 * places for the paise rules to drift.
 */

export class CreateVendorDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  pan?: string;

  /** TDS section deducted on this vendor's bills, e.g. 194C. */
  @IsOptional()
  @IsIn(TDS_SECTION_CODES)
  tdsSection?: string;

  @IsOptional()
  @IsInt({ message: 'tdsRateBps is whole basis points: 100 = 1%' })
  @Min(0)
  @Max(10000)
  tdsRateBps?: number;
}

/** PATCH /purchase/vendors/:id — PAN and the TDS applied to the vendor's bills. */
/** PATCH /purchase/vendors/:id — contact details and tax settings; only the fields sent change. */
export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  /** null or '' clears it. */
  @IsOptional()
  @IsString()
  gstin?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  pan?: string | null;

  /** null stops deducting TDS for this vendor. */
  @IsOptional()
  @IsIn([...TDS_SECTION_CODES, null])
  tdsSection?: string | null;

  @IsOptional()
  @IsInt({ message: 'tdsRateBps is whole basis points: 100 = 1%' })
  @Min(0)
  @Max(10000)
  tdsRateBps?: number | null;
}

export class CreateBillDto {
  @IsString({ message: 'vendorId is required — pick an existing vendor' })
  vendorId: string;

  @IsOptional()
  @IsString()
  billNumber?: string | null;

  @IsISO8601({}, { message: 'billDate must be a date like 2026-08-25' })
  billDate: string;

  @IsOptional()
  @IsISO8601({}, { message: 'dueDate must be a date like 2026-09-09' })
  dueDate?: string | null;

  @ValidateNested()
  @Type(() => AmountsPaiseDto)
  amountsPaise: AmountsPaiseDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems?: LineItemDto[];

  @IsOptional()
  @IsString()
  notes?: string | null;

  /** GST on this purchase is ours to pay (reverse charge). */
  @IsOptional()
  @IsBoolean()
  isReverseCharge?: boolean;

  /**
   * TDS section for this bill, overriding the vendor's; 'none' deducts nothing.
   * Omitted: the vendor's section and rate apply.
   */
  @IsOptional()
  @IsIn([...TDS_SECTION_CODES, 'none'])
  tdsSection?: string;

  @IsOptional()
  @IsInt({ message: 'tdsRateBps is whole basis points: 100 = 1%' })
  @Min(0)
  @Max(10000)
  tdsRateBps?: number;
}

/** Optional body for recording a payment: when, and how much (default: all of it). */
export class PayBillDto {
  @IsOptional()
  @IsISO8601({}, { message: 'paidOn must be a date like 2026-10-10' })
  paidOn?: string;

  /** Part of what is owed; everything outstanding when omitted. */
  @IsOptional()
  @IsInt({ message: 'amountPaise must be an integer number of paise' })
  @Min(1)
  amountPaise?: number;
}

/** Body for raising a credit or debit note against a posted document. */
export class CreateDebitNoteDto {
  @IsISO8601({}, { message: 'noteDate must be a date like 2026-10-20' })
  noteDate: string;

  @IsString()
  @Length(3, 300, { message: 'Say why the note is raised (3–300 characters)' })
  reason: string;

  /** Taxable value to take off; tax follows in the original's proportions. */
  @IsInt({ message: 'taxableValuePaise must be an integer number of paise' })
  @Min(1)
  taxableValuePaise: number;
}
