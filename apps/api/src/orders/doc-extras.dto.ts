import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';

/**
 * What every sales document's form may send besides its lines: the
 * discount, the adjustment and the words around them. The amounts are the
 * server's to work out; these say only what was asked for.
 */

/** A discount before tax: a percent of the lines (to two decimals), or an amount in paise. One or the other. */
export class DiscountDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'A discount percent has two decimals at most.' }) @Min(0) @Max(100) percent?: number | null;
  @IsOptional() @IsInt({ message: 'A discount amount is whole paise.' }) @Min(0) amountPaise?: number | null;
}

/** After tax, not taxed: rounding, at most ₹99.99 either way (checked by the service). */
export class AdjustmentDto {
  @IsOptional() @IsString() @Length(0, 40) label?: string | null;
  @IsInt({ message: 'An adjustment is whole paise.' }) paise: number;
}

/** The fields a quote, order, challan, invoice, recurring invoice or credit note may carry. All optional. */
export class DocWordsDto {
  @IsOptional() @IsString() @Length(0, 60) referenceNumber?: string | null;
  @IsOptional() @IsString() @Length(0, 250) subject?: string | null;
  @IsOptional() @IsString() @Length(0, 80) salespersonName?: string | null;
  @IsOptional() @IsString() @Length(0, 3000) termsAndConditions?: string | null;
}

export class PricedDocDto extends DocWordsDto {
  @IsOptional() @ValidateNested() @Type(() => DiscountDto) discount?: DiscountDto | null;
  @IsOptional() @ValidateNested() @Type(() => AdjustmentDto) adjustment?: AdjustmentDto | null;
}
