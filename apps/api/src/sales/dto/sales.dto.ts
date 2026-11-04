import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { UQC_CODES } from '../../items/hsn';

/**
 * Bodies for POST /api/v1/sales/*.
 *
 * These are classes, not TypeScript types, on purpose: Nest's ValidationPipe
 * can only validate a class metatype. The controller previously typed the body
 * as `Omit<CreateInvoiceInput, 'orgId'>` — a type, erased at runtime — so
 * nothing was validated and a wrong shape reached the service, which threw and
 * surfaced as a bare 500. A caller could not tell what they had got wrong.
 *
 * orgId is deliberately absent — it comes from the verified JWT, never the body.
 */

export class AmountsPaiseDto {
  @IsInt({ message: 'taxableValue must be an integer number of paise' })
  @Min(0)
  taxableValue: number;

  @IsInt({ message: 'cgst must be an integer number of paise' })
  @Min(0)
  cgst: number;

  @IsInt({ message: 'sgst must be an integer number of paise' })
  @Min(0)
  sgst: number;

  @IsInt({ message: 'igst must be an integer number of paise' })
  @Min(0)
  igst: number;

  @IsInt({ message: 'cess must be an integer number of paise' })
  @Min(0)
  cess: number;

  @IsInt({ message: 'total must be an integer number of paise' })
  @Min(0)
  total: number;
}

export class LineItemDto {
  @IsString()
  @Length(1, 500)
  description: string;

  @IsOptional()
  @IsString()
  hsnSac?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  qty?: number;

  @IsInt({ message: 'ratePaise must be an integer number of paise' })
  @Min(0)
  ratePaise: number;

  @IsInt({ message: 'amountPaise must be an integer number of paise' })
  @Min(0)
  amountPaise: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  taxRatePct?: number;

  /** An item from the item master; its HSN/SAC, unit, rate and account fill what the line leaves out. */
  @IsOptional()
  @IsMongoId()
  itemId?: string;

  @IsOptional()
  @IsIn(UQC_CODES)
  uqc?: string;

  /** The project the line's income or cost belongs to. */
  @IsOptional()
  @IsMongoId()
  projectId?: string;
}

export class CreateCustomerDto {
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
  @Length(0, 100)
  city?: string;

  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, { message: 'A pincode is six digits and does not start with 0.' })
  pincode?: string;

  /** GST state code, for a customer without a GSTIN. */
  @IsOptional()
  @Matches(/^\d{2}$/, { message: 'stateCode must be a two-digit GST state code, like 27' })
  stateCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/** POST /sales/invoices/:id/email */
export class EmailInvoiceDto {
  /** Defaults to the customer's email. */
  @IsOptional()
  @IsString()
  @Length(3, 200)
  to?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cc?: string[];

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  message?: string;
}

/** PATCH /sales/customers/:id — only the fields sent change. */
export class UpdateCustomerDto {
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
  @Length(0, 100)
  city?: string | null;

  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, { message: 'A pincode is six digits and does not start with 0.' })
  pincode?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  /** GST state code, for a customer without a GSTIN; a GSTIN sets it. */
  @IsOptional()
  @Matches(/^\d{2}$/, { message: 'stateCode must be a two-digit GST state code, like 27' })
  stateCode?: string | null;
}

export class CreateSalesInvoiceDto {
  @IsString({ message: 'customerId is required — pick an existing customer' })
  customerId: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string | null;

  @IsISO8601({}, { message: 'invoiceDate must be a date like 2026-08-25' })
  invoiceDate: string;

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
}

/** Optional body for recording a payment: when, and how much (default: all of it). */
export class PayInvoiceDto {
  @IsOptional()
  @IsISO8601({}, { message: 'paidOn must be a date like 2026-10-10' })
  paidOn?: string;

  /** Part of what is owed; everything outstanding when omitted. */
  @IsOptional()
  @IsInt({ message: 'amountPaise must be an integer number of paise' })
  @Min(0)
  amountPaise?: number;

  /** TDS the customer deducted from this payment and paid to the government for us. */
  @IsOptional()
  @IsInt({ message: 'tdsPaise must be an integer number of paise' })
  @Min(0)
  tdsPaise?: number;
}

/** Body for raising a credit or debit note against a posted document. */
export class CreateCreditNoteDto {
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
