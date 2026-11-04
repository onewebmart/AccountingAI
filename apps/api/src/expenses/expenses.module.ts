import { Body, Controller, Get, Module, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Min, ValidateNested } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { GlModule } from '../gl/gl.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { ExpenseClaim, ExpenseClaimSchema, ExpenseRulesDoc, ExpenseRulesSchema } from './schemas/expense-claim.schema';
import { ExpenseClaimsService } from './expense-claims.service';

interface AuthRequest {
  user: { orgId: string; sub: string; role: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class ClaimLineDto {
  @Matches(DATE) date: string;
  @IsOptional() @IsIn(['expense', 'mileage']) kind?: 'expense' | 'mileage';
  @IsOptional() @IsString() @Length(0, 120) merchant?: string | null;
  @IsString() @Length(1, 300) description: string;
  @IsMongoId() expenseAccountId: string;
  @IsOptional() @IsInt() @Min(0) amountPaise?: number;
  @IsOptional() @IsInt() @Min(0) gstPaise?: number;
  @IsOptional() @IsString() @Length(0, 15) merchantGstin?: string | null;
  @IsOptional() @IsString() @Length(0, 8) hsnSac?: string | null;
  @IsOptional() @IsNumber() @Min(0) km?: number | null;
  @IsOptional() @IsMongoId() receiptId?: string | null;
}

class ClaimDto {
  @IsString() @Length(1, 120) title: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ClaimLineDto) lines: ClaimLineDto[];
}

class ClaimUpdateDto {
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ClaimLineDto) lines?: ClaimLineDto[];
}

class RulesDto {
  @IsOptional() @IsInt() @Min(0) receiptRequiredAbovePaise?: number;
  @IsOptional() @IsInt() @Min(0) lineLimitPaise?: number | null;
  @IsOptional() @IsInt() @Min(0) mileageRatePaise?: number;
}

class PaidDto {
  @IsOptional() @Matches(DATE) paidOn?: string;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('expense-claims')
export class ExpenseClaimsController {
  constructor(private readonly claims: ExpenseClaimsService) {}

  @Get()
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  list(@Request() req: AuthRequest) {
    return this.claims.list(req.user.orgId, req.user.sub, req.user.role);
  }

  @Get('rules')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  rules(@Request() req: AuthRequest) {
    return this.claims.rules(req.user.orgId);
  }

  @Patch('rules')
  @RequirePermission(Permission.MANAGE_ORG)
  setRules(@Request() req: AuthRequest, @Body() body: RulesDto) {
    return this.claims.setRules(req.user.orgId, req.user.sub, body);
  }

  @Post()
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  create(@Request() req: AuthRequest, @Body() body: ClaimDto) {
    return this.claims.create(req.user.orgId, req.user.sub, body);
  }

  @Patch(':id')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  update(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: ClaimUpdateDto) {
    return this.claims.update(req.user.orgId, req.user.sub, id, body);
  }

  @Post(':id/submit')
  @RequirePermission(Permission.UPLOAD_DOCUMENT)
  submit(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.claims.submit(req.user.orgId, req.user.sub, req.user.role, id);
  }

  @Post(':id/post')
  @RequirePermission(Permission.POST_JOURNAL)
  post(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.claims.post(req.user.orgId, req.user.sub, id);
  }

  @Post(':id/reimburse')
  @RequirePermission(Permission.POST_JOURNAL)
  reimburse(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: PaidDto) {
    return this.claims.reimburse(req.user.orgId, req.user.sub, req.user.role, id, body.paidOn);
  }
}

/** Employees' expense claims, approved by someone else, posted by an accountant. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExpenseClaim.name, schema: ExpenseClaimSchema },
      { name: ExpenseRulesDoc.name, schema: ExpenseRulesSchema },
      { name: OrgSettings.name, schema: OrgSettingsSchema },
      { name: User.name, schema: UserSchema },
    ]),
    GlModule,
    ApprovalsModule,
  ],
  controllers: [ExpenseClaimsController],
  providers: [ExpenseClaimsService],
})
export class ExpensesModule {}
