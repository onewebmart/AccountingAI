import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Permission, VoucherType } from '@ai-accounting/shared';
import { RequirePermission, CurrentUser, JwtPayload } from '../auth/decorators';
import { JournalsService } from './journals.service';
import { PostingService } from '../gl/posting.service';
import { JournalReversalService } from './journal-reversal.service';
import { ManualVouchersService, ManualVoucherLine } from './manual-vouchers.service';

interface ManualJournalBody {
  voucherType?: VoucherType;
  financialYear?: string;
  date?: string;
  /** Notes: why the entry is made. */
  narration?: string;
  reference?: string | null;
  /** The person's own Journal#; the JNL voucher number is allocated as usual. */
  journalNumber?: string | null;
  reverseOn?: string | null;
  publishReversalOnDate?: boolean;
  lines: ManualVoucherLine[];
}

/** Indian financial year (Apr–Mar) for a yyyy-mm-dd string. */
function financialYearFor(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 4
    ? `${y}-${(y + 1).toString().slice(-2)}`
    : `${y - 1}-${y.toString().slice(-2)}`;
}

@Controller('journals')
export class JournalsController {
  constructor(
    private readonly journals: JournalsService,
    private readonly posting: PostingService,
    private readonly reversals: JournalReversalService,
    private readonly vouchers: ManualVouchersService,
  ) {}

  @Get()
  @RequirePermission(Permission.VIEW_JOURNAL)
  async list(
    @CurrentUser() user: JwtPayload,
    @Query('voucherType') voucherType?: VoucherType,
    @Query('financialYear') financialYear?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.journals.list(user.orgId, {
      voucherType,
      financialYear,
      from,
      to,
    });
    return { data, total: data.length };
  }

  @Get('summary')
  @RequirePermission(Permission.VIEW_JOURNAL)
  summary(
    @CurrentUser() user: JwtPayload,
    @Query('financialYear') financialYear?: string,
  ) {
    return this.journals.summary(user.orgId, financialYear);
  }

  /** The Journal# the next journal dated `date` will get. A preview; it is allocated on posting. */
  @Get('next-number')
  @RequirePermission(Permission.VIEW_JOURNAL)
  nextNumber(@CurrentUser() user: JwtPayload, @Query('date') date?: string) {
    const on = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
    return this.journals.nextNumber(user.orgId, on);
  }

  @Get(':id')
  @RequirePermission(Permission.VIEW_JOURNAL)
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.journals.findOne(user.orgId, id);
  }

  /** Manual voucher entry. Balance and gapless numbering are enforced by PostingService. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.POST_JOURNAL)
  async create(@CurrentUser() user: JwtPayload, @Body() body: ManualJournalBody) {
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    const journal = await this.vouchers.post(user.orgId, user.sub, user.role, { ...body, date, financialYear: body.financialYear ?? financialYearFor(date) });

    return this.journals.findOne(user.orgId, journal._id.toString());
  }

  /** Invariant 3: a posted journal is never mutated — corrections are contra entries. */
  @Post(':id/reverse')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.REVERSE_JOURNAL)
  async reverse(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const exists = await this.journals.exists(user.orgId, id);
    if (!exists) throw new BadRequestException('Voucher not found.');

    const reversal = await this.reversals.reverse(id, user.orgId, user.sub);
    return this.journals.findOne(user.orgId, reversal._id.toString());
  }
}
