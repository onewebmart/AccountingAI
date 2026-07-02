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
import { Permission, ProposedEntryStatus } from '@ai-accounting/shared';
import { RequirePermission, CurrentUser, JwtPayload } from '../auth/decorators';
import { ProposalsService } from './proposals.service';

class ApproveBodyDto {
  lines?: Array<{
    accountId: string;
    accountName: string;
    debitPaise: number;
    creditPaise: number;
    description?: string;
  }>;
}

class RejectBodyDto {
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
