import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { FirmService, LeadSource, LeadStage } from '@ai-accounting/shared';
import { FirmAdminGuard } from '../../white-label/white-label.guard';
import { LeadsService } from './leads.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string; firmId?: string };
}

export class CreateLeadDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  contactName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10,15}$/, { message: 'whatsappNumber must be 10–15 digits' })
  whatsappNumber?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsEnum(LeadSource)
  source: LeadSource;

  @IsOptional()
  @IsArray()
  @IsEnum(FirmService, { each: true })
  services?: FirmService[];

  @IsOptional()
  @IsString()
  @Length(0, 4000)
  enquiryNotes?: string;

  /** Integer paise (Invariant 1) — ₹15,000 is 1500000. */
  @IsOptional()
  @IsInt({ message: 'estimatedValuePaise must be an integer number of paise' })
  @Min(0)
  estimatedValuePaise?: number;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}

export class ChangeStageDto {
  @IsEnum(LeadStage)
  stage: LeadStage;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

@Controller('crm/leads')
@UseGuards(AuthGuard('jwt'), FirmAdminGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(@Query('stage') stage?: LeadStage) {
    return this.leads.list({ stage });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.leads.findById(id);
  }

  @Post()
  create(@Request() req: AuthRequest, @Body() dto: CreateLeadDto) {
    return this.leads.create({ firmId: req.user.firmId!, ...dto });
  }

  /** Queue an AI qualification pass. The verdict is advisory. */
  @Post(':id/qualify')
  qualify(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.leads.requestQualification(id, req.user.firmId!);
  }

  /** Move a lead. Humans only — the qualifier never calls this. */
  @Post(':id/stage')
  changeStage(
    @Request() req: AuthRequest,
    @Param('id') id: string,
    @Body() dto: ChangeStageDto,
  ) {
    return this.leads.changeStage(id, dto.stage, req.user.sub, dto.note);
  }

  /** Nudge proposals that have gone quiet. */
  @Post('follow-ups/run')
  runFollowUps(@Request() req: AuthRequest) {
    return this.leads.runFollowUps(req.user.firmId!);
  }
}
