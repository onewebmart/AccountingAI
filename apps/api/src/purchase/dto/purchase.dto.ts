import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { TDS_SECTION_CODES } from '../../gl/tds';
import { UQC_CODES } from '../../items/hsn';
import { AmountsPaiseDto, LineItemDto } from '../../sales/dto/sales.dto';
import { filledValue, PartyProfileDto } from '../../gl/party-profile.dto';
import { PARTY_TYPES } from '../../gl/party-profile';

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

/**
 * POST /purchase/vendors. Only the display name is required; the rest of
 * what a vendor form holds (type, contact person, addresses, terms) is in
 * PartyProfileDto. Bank and MSME details go through the edit, which audits
 * a bank account on its own.
 */
export class CreateVendorDto extends PartyProfileDto {
  /** The display name. */
  @IsString()
  @Length(1, 200)
  name: string;

  @IsOptional()
  @IsIn(PARTY_TYPES)
  vendorType?: string;

  @IsOptional()
  @IsString()
  gstin?: string;

  /** The work phone. */
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @ValidateIf(filledValue)
  @IsEmail({}, { message: 'email must look like name@example.com' })
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  city?: string;

  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, { message: 'A pincode is six digits and does not start with 0.' })
  pincode?: string;

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
export class VendorBankAccountDto {
  @IsOptional()
  @IsString()
  @Length(0, 120)
  accountName?: string | null;

  @IsString()
  @Length(6, 24)
  accountNumber: string;

  @IsString()
  @Length(11, 11, { message: 'An IFSC is 11 characters, like HDFC0001234' })
  ifsc: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  bankName?: string | null;
}

export class VendorMsmeDto {
  @IsString()
  @Length(19, 19, { message: 'A Udyam number looks like UDYAM-MH-26-0012345' })
  udyamNumber: string;

  @IsIn(['micro', 'small', 'medium'])
  category: 'micro' | 'small' | 'medium';

  @IsIn(['manufacturing', 'services', 'trading'])
  activity: 'manufacturing' | 'services' | 'trading';

  @IsOptional()
  @IsBoolean()
  writtenAgreement?: boolean;
}

/** PATCH /purchase/vendors/:id — contact details and tax settings; only the fields sent change. */
export class UpdateVendorDto extends PartyProfileDto {
  /** null removes it. */
  @IsOptional()
  @ValidateNested()
  @Type(() => VendorBankAccountDto)
  bankAccount?: VendorBankAccountDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => VendorMsmeDto)
  msme?: VendorMsmeDto | null;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @ValidateIf(filledValue)
  @IsIn(PARTY_TYPES)
  vendorType?: string | null;

  /** null or '' clears it. */
  @IsOptional()
  @IsString()
  gstin?: string | null;

  /** The work phone. */
  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @ValidateIf(filledValue)
  @IsEmail({}, { message: 'email must look like name@example.com' })
  email?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  city?: string | null;

  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, { message: 'A pincode is six digits and does not start with 0.' })
  pincode?: string | null;

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

/** One line of a bill typed line by line; the server works out its amount and tax. */
export class BillLineDto {
  @IsOptional()
  @IsMongoId()
  itemId?: string | null;

  @IsString()
  @Length(1, 500)
  description: string;

  @IsOptional()
  @IsString()
  @Length(0, 8)
  hsnSac?: string | null;

  @IsOptional()
  @IsIn([...UQC_CODES, null])
  uqc?: string | null;

  /** Up to three decimals: 2.5 kg. */
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'qty is a number, to three decimals at most' })
  @Min(0.001)
  qty: number;

  @IsInt({ message: 'ratePaise must be an integer number of paise' })
  @Min(0)
  ratePaise: number;

  @IsIn([0, 3, 5, 12, 18, 28, 40], { message: 'taxRatePct must be a GST slab' })
  taxRatePct: number;

  @IsOptional()
  @IsMongoId()
  projectId?: string | null;

  /** The account this line is booked to; the item's, or Purchases, when left out. */
  @IsOptional()
  @IsMongoId()
  accountId?: string | null;
}

/** POST /purchase/bills/from-lines — a draft bill priced on the server from its lines. */
export class CreateBillFromLinesDto {
  @IsMongoId({ message: 'vendorId is required — pick an existing vendor' })
  vendorId: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  billNumber?: string | null;

  @IsISO8601({}, { message: 'billDate must be a date like 2026-08-25' })
  billDate: string;

  @IsOptional()
  @IsISO8601({}, { message: 'dueDate must be a date like 2026-09-09' })
  dueDate?: string | null;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one line.' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BillLineDto)
  lines: BillLineDto[];

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isReverseCharge?: boolean;

  @IsOptional()
  @IsIn([...TDS_SECTION_CODES, 'none'])
  tdsSection?: string;

  @IsOptional()
  @IsInt({ message: 'tdsRateBps is whole basis points: 100 = 1%' })
  @Min(0)
  @Max(10000)
  tdsRateBps?: number;
}
