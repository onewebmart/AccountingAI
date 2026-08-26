import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

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
  @IsInt({ message: 'openingBalancePaise must be an integer number of paise' })
  openingBalancePaise?: number;

  @IsOptional()
  @IsString()
  notes?: string;
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
