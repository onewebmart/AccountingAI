import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { FirmService, PracticeInvoiceStatus } from '@ai-accounting/shared';
import { FirmAdminGuard } from '../../white-label/white-label.guard';
import { PracticeInvoiceService } from './practice-invoice.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string; firmId?: string };
}

export class InvoiceLineDto {
  @IsString()
  @Length(1, 300)
  description: string;

  @IsOptional()
  @IsEnum(FirmService)
  service?: FirmService;

  /** Integer paise (Invariant 1) — ₹48,000 is 4800000. */
  @IsInt({ message: 'amountPaise must be an integer number of paise' })
  @Min(0)
  amountPaise: number;
}

export class CreateInvoiceDto {
  @IsString()
  clientOrgId: string;

  @IsISO8601()
  issueDate: string;

  @IsISO8601()
  dueDate: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines: InvoiceLineDto[];

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

export class RecordPaymentDto {
  @IsInt({ message: 'amountPaise must be an integer number of paise' })
  @Min(1)
  amountPaise: number;

  @IsISO8601()
  receivedOn: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  reference?: string;
}

export class CancelInvoiceDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

@Controller('crm/invoices')
@UseGuards(AuthGuard('jwt'), FirmAdminGuard)
export class PracticeInvoiceController {
  constructor(private readonly invoices: PracticeInvoiceService) {}

  @Get()
  list(@Query('status') status?: PracticeInvoiceStatus) {
    return this.invoices.list({ status });
  }

  /** Outstanding money bucketed by how late it is. */
  @Get('ageing')
  ageing() {
    return this.invoices.ageing();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.invoices.findById(id);
  }

  @Post()
  create(@Request() req: AuthRequest, @Body() dto: CreateInvoiceDto) {
    return this.invoices.create({ firmId: req.user.firmId!, ...dto });
  }

  /** Draft → SENT. This is what starts the collection ladder. */
  @Post(':id/issue')
  issue(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.invoices.issue(id, req.user.sub);
  }

  @Post(':id/payments')
  recordPayment(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.invoices.recordPayment(id, { ...dto, actorId: req.user.sub });
  }

  @Post(':id/cancel')
  cancel(@Request() req: AuthRequest, @Param('id') id: string, @Body() dto: CancelInvoiceDto) {
    return this.invoices.cancel(id, req.user.sub, dto.reason);
  }

  /** Climb the collection ladder for everything falling due today. */
  @Post('collections/run')
  runCollections(@Request() req: AuthRequest) {
    return this.invoices.runCollections(req.user.firmId!);
  }
}
