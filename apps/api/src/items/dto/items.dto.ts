import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import { ITEM_GST_RATES, UQC_CODES } from '../hsn';

export class HsnSourceDto {
  @IsIn(['history', 'rule', 'model'])
  by: 'history' | 'rule' | 'model';

  @IsOptional()
  @IsString()
  @Length(0, 300)
  reason?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number | null;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 50)
  code?: string | null;

  @IsOptional()
  @IsIn(['goods', 'service'])
  kind?: 'goods' | 'service';

  @IsOptional()
  @IsString()
  @Length(0, 8)
  hsnSac?: string | null;

  @IsOptional()
  @IsIn(UQC_CODES)
  uqc?: string;

  @IsOptional()
  @IsIn(ITEM_GST_RATES)
  gstRatePct?: number | null;

  @IsOptional()
  @IsInt({ message: 'salePricePaise must be an integer number of paise' })
  @Min(0)
  salePricePaise?: number | null;

  @IsOptional()
  @IsInt({ message: 'purchasePricePaise must be an integer number of paise' })
  @Min(0)
  purchasePricePaise?: number | null;

  @IsOptional()
  @IsMongoId()
  incomeAccountId?: string | null;

  @IsOptional()
  @IsMongoId()
  expenseAccountId?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => HsnSourceDto)
  hsnSource?: HsnSourceDto | null;

  @IsOptional()
  @IsBoolean()
  trackStock?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderQty?: number | null;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  purchaseDescription?: string | null;

  @IsOptional()
  @IsMongoId()
  preferredVendorId?: string | null;

  @IsOptional()
  @IsBoolean()
  forSale?: boolean;

  @IsOptional()
  @IsBoolean()
  forPurchase?: boolean;
}

export class CreateItemDto extends UpdateItemDto {
  @IsString()
  @Length(1, 200)
  declare name: string;

  @IsIn(['goods', 'service'])
  declare kind: 'goods' | 'service';
}

export class SuggestHsnDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string | null;

  @IsOptional()
  @IsIn(['goods', 'service'])
  kind?: 'goods' | 'service' | null;
}
