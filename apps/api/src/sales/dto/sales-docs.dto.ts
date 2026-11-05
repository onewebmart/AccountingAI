import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { UQC_CODES } from '../../items/hsn';
import { AdjustmentDto, DiscountDto } from '../../orders/doc-extras.dto';
import { CreateInvoiceFromLinesDto } from './sales.dto';

/**
 * Bodies for the sales forms laid out like a full sales document: the
 * invoice typed line by line with its discount, adjustment and terms, and the
 * itemised credit note. Kept apart from sales.dto.ts so the customer and
 * invoice bodies can change independently.
 */

/** POST /sales/invoices/from-lines, with everything the form can send. */
export class InvoiceFromLinesBodyDto extends CreateInvoiceFromLinesDto {
  /** The customer's order number. */
  @IsOptional() @IsString() @Length(0, 60) referenceNumber?: string | null;
  @IsOptional() @IsString() @Length(0, 250) subject?: string | null;
  @IsOptional() @IsString() @Length(0, 80) salespersonName?: string | null;
  @IsOptional() @IsString() @Length(0, 3000) termsAndConditions?: string | null;
  /** With no due date, the invoice is due this many days after its date. */
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermsDays?: number | null;
  /** The project the whole invoice is for: lines without one take it. */
  @IsOptional() @IsMongoId() projectId?: string | null;
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) discount?: DiscountDto | null;
  @IsOptional() @ValidateNested() @Type(() => AdjustmentDto) adjustment?: AdjustmentDto | null;
}

/** One line of an itemised credit note: what is credited, at what rate, to which income account. */
export class CreditNoteLineDto {
  @IsString() @Length(1, 500) description: string;
  @IsOptional() @IsMongoId() itemId?: string | null;
  @IsOptional() @IsString() @Length(0, 8) hsnSac?: string | null;
  @IsOptional() @IsIn(UQC_CODES) uqc?: string | null;
  @IsNumber({}, { message: 'qty must be a number' }) @Min(0) qty: number;
  @IsInt({ message: 'ratePaise must be whole paise' }) @Min(0) ratePaise: number;
  @IsInt({ message: 'taxRatePct must be a GST slab, like 18' }) @Min(0) taxRatePct: number;
  /** The income account the line comes back off; Sales when not given. */
  @IsOptional() @IsMongoId() accountId?: string | null;
}

/** POST /sales/credit-notes — an itemised credit note against one of the customer's posted invoices. */
export class ItemisedCreditNoteDto {
  @IsMongoId({ message: 'Pick the customer.' }) customerId: string;
  /** The invoice it corrects. GST asks a credit note to name it (rule 53(1A)); GSTR-1 files the note beside it. */
  @IsMongoId({ message: 'Pick the invoice this credit note is against.' }) invoiceId: string;
  @IsISO8601({}, { message: 'noteDate must be a date like 2026-10-20' }) noteDate: string;
  @IsString() @Length(3, 300, { message: 'Say why the note is raised (3–300 characters)' }) reason: string;
  @IsArray() @ArrayMinSize(1, { message: 'Add at least one line.' }) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => CreditNoteLineDto) lines: CreditNoteLineDto[];
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) discount?: DiscountDto | null;
  @IsOptional() @IsString() @Length(0, 60) referenceNumber?: string | null;
  @IsOptional() @IsString() @Length(0, 250) subject?: string | null;
  @IsOptional() @IsString() @Length(0, 80) salespersonName?: string | null;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string | null;
  @IsOptional() @IsString() @Length(0, 3000) termsAndConditions?: string | null;
}
