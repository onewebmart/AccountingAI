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
  @IsInt({ message: 'openingBalancePaise must be an integer number of paise' })
  openingBalancePaise?: number;

  @IsOptional()
  @IsString()
  notes?: string;
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
}
