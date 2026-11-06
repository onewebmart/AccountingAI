import { IsIn, IsMongoId, IsOptional, Matches } from 'class-validator';
import type { RunParams } from './types';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const FY = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The period and filters any report may take; each report then keeps only its own (see cleanParams). */
export class CenterParamsDto implements RunParams {
  @IsOptional() @Matches(MONTH, { message: 'from is a month like 2026-04' }) from?: string;
  @IsOptional() @Matches(MONTH, { message: 'to is a month like 2026-11' }) to?: string;
  @IsOptional() @Matches(FY, { message: 'financialYear looks like 2026-27' }) financialYear?: string;
  @IsOptional() @Matches(MONTH, { message: 'through is a month like 2026-11' }) through?: string;
  @IsOptional() @Matches(DATE, { message: 'asOf is a date like 2026-11-30' }) asOf?: string;
  @IsOptional() @IsIn(['Q1', 'Q2', 'Q3', 'Q4']) quarter?: string;
  @IsOptional() @IsMongoId() customerId?: string;
  @IsOptional() @IsMongoId() vendorId?: string;
  @IsOptional() @IsMongoId() accountId?: string;
  @IsOptional() @IsMongoId() projectId?: string;
  @IsOptional() @IsMongoId() itemId?: string;
  @IsOptional() @Matches(/^[A-Za-z0-9:_-]{1,64}$/) userId?: string;
  @IsOptional() @Matches(/^[A-Za-z_]{1,32}$/) status?: string;
  @IsOptional() @IsIn(['heads', 'accounts']) detail?: string;
}

/** A built-in report's key, or a custom report's. */
export const REPORT_KEY = /^[a-z0-9_]{2,64}$|^custom\.[a-f0-9]{24}$/;
