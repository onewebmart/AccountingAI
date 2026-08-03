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

interface ManualJournalBody {
  voucherType?: VoucherType;
  financialYear?: string;
  date?: string;
  narration?: string;
  lines: Array<{
    accountId: string;
    description?: string;
    debitPaise: number;
    creditPaise: number;
  }>;
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
    if (!Array.isArray(body.lines) || body.lines.length < 2) {
      throw new BadRequestException('A voucher needs at least two lines.');
    }

    const date = body.date ?? new Date().toISOString().slice(0, 10);
    const journal = await this.posting.post({
      orgId: user.orgId,
      voucherType: body.voucherType ?? VoucherType.JOURNAL,
      financialYear: body.financialYear ?? financialYearFor(date),
      date,
      narration: body.narration,
      postedBy: user.sub,
      lines: body.lines,
    });

    return this.journals.findOne(user.orgId, journal._id.toString());
  }

  /** Invariant 3: a posted journal is never mutated — corrections are contra entries. */
  @Post(':id/reverse')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.REVERSE_JOURNAL)
  async reverse(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const exists = await this.journals.exists(user.orgId, id);
    if (!exists) throw new BadRequestException('Voucher not found.');

    const reversal = await this.posting.reverse(id, user.sub);
    return this.journals.findOne(user.orgId, reversal._id.toString());
  }
}
