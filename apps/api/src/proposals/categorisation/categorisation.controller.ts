import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import { BankCategorisationService } from './bank-categorisation.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

class CategoriseLinesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  lineIds: string[];
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('banking/lines')
export class CategorisationController {
  constructor(private readonly bankCategorisation: BankCategorisationService) {}

  /**
   * Send unmatched bank lines to be categorised. Each becomes a proposal in
   * the review queue a moment later; nothing posts until it is approved.
   */
  @Post('categorise')
  @RequirePermission(Permission.REVIEW_PROPOSAL)
  categorise(@Request() req: AuthRequest, @Body() body: CategoriseLinesDto) {
    return this.bankCategorisation.queueLines(req.user.orgId, body.lineIds);
  }
}
