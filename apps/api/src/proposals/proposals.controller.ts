import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Permission, ProposedEntryStatus } from '@ai-accounting/shared';
import { RequirePermission, CurrentUser, JwtPayload } from '../auth/decorators';
import { ProposalsService } from './proposals.service';

/**
 * The global ValidationPipe runs with whitelist + forbidNonWhitelisted, so every
 * accepted property needs a class-validator decorator. Without them the pipe sees
 * no whitelist at all and rejects the request outright.
 */
class ApproveLineDto {
  @IsMongoId()
  accountId: string;

  @IsString()
  accountName: string;

  @IsInt()
  @Min(0)
  debitPaise: number;

  @IsInt()
  @Min(0)
  creditPaise: number;

  @IsOptional()
  @IsString()
  description?: string;
}

class ApproveBodyDto {
  /** Human-corrected journal lines. Omitted when the AI suggestion is accepted as-is. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApproveLineDto)
  lines?: ApproveLineDto[];
}

class RejectBodyDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@Controller('proposals')
export class ProposalsController {
  constructor(private proposals: ProposalsService) {}

  @Get()
  @RequirePermission(Permission.REVIEW_PROPOSAL)
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: ProposedEntryStatus,
  ) {
    return this.proposals.list(user.orgId, status);
  }

  @Get(':id')
  @RequirePermission(Permission.REVIEW_PROPOSAL)
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.proposals.findById(id, user.orgId);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.APPROVE_PROPOSAL)
  approve(
    @Param('id') id: string,
    @Body() body: ApproveBodyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.proposals.approve({
      proposalId: id,
      orgId: user.orgId,
      actorId: user.sub,
      lines: body.lines,
    });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.APPROVE_PROPOSAL)
  reject(
    @Param('id') id: string,
    @Body() body: RejectBodyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.proposals.reject({
      proposalId: id,
      orgId: user.orgId,
      actorId: user.sub,
      reason: body.reason,
    });
  }

  @Post('approve-high-confidence')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.APPROVE_PROPOSAL)
  approveHighConfidence(
    @CurrentUser() user: JwtPayload,
    @Query('threshold') threshold?: string,
  ) {
    const t = threshold ? parseFloat(threshold) : 0.9;
    return this.proposals.approveHighConfidence(user.orgId, user.sub, t);
  }
}
