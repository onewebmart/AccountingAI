import { VoucherType } from '../types/enums';
import { Paise } from '../types/money';

export interface JournalLineDto {
  accountId: string;
  debitPaise: Paise;
  creditPaise: Paise;
  narration?: string;
}

export interface CreateJournalDto {
  voucherType: VoucherType;
  date: string;
  narration?: string;
  lines: JournalLineDto[];
  referenceId?: string;
  referenceType?: string;
}

export interface PostJournalDto extends CreateJournalDto {
  orgId: string;
  financialYear: string;
  postedBy: string;
}
