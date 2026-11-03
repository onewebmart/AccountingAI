import { BadRequestException, Body, Controller, Get, Param, Post, Request, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsMongoId, IsObject, IsOptional, Matches, Min, ValidateNested } from 'class-validator';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { MigrationService } from './migration.service';
import { AccountGroup } from './source-parsers';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

class ManualAccountLineDto {
  @IsMongoId()
  accountId: string;

  @IsInt({ message: 'debitPaise must be whole paise' })
  @Min(0)
  debitPaise: number;

  @IsInt({ message: 'creditPaise must be whole paise' })
  @Min(0)
  creditPaise: number;
}

class ManualPartyLineDto {
  @IsIn(['customer', 'vendor'])
  kind: 'customer' | 'vendor';

  @IsMongoId()
  partyId: string;

  /** Positive: they owe us, or we owe them. Negative: an advance. */
  @IsInt({ message: 'balancePaise must be whole paise' })
  balancePaise: number;
}

class ManualOpeningDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ManualAccountLineDto)
  accounts?: ManualAccountLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ManualPartyLineDto)
  parties?: ManualPartyLineDto[];
}

class CommitImportDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'openingDate must be a date like 2026-04-01' })
  openingDate: string;

  /** Account name → what it is, for accounts the import could not place. */
  @IsOptional()
  @IsObject()
  groups?: Record<string, AccountGroup>;

  @IsOptional()
  @IsBoolean()
  differenceToSuspense?: boolean;
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('migration')
export class MigrationController {
  constructor(private readonly migration: MigrationService) {}

  @Get()
  @RequirePermission(Permission.MANAGE_ORG)
  list(@Request() req: AuthRequest) {
    return this.migration.list(req.user.orgId);
  }

  /** Read the files and show what would come in. Writes nothing to the books. */
  @Post('preview')
  @RequirePermission(Permission.MANAGE_ORG)
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (/\.(xml|csv|xlsx?)$/i.test(file.originalname)) cb(null, true);
        else cb(new BadRequestException('Upload Tally XML, or CSV or Excel exports.'), false);
      },
    }),
  )
  preview(@Request() req: AuthRequest, @UploadedFiles() files: Express.Multer.File[]) {
    return this.migration.preview(req.user.orgId, req.user.sub, files ?? []);
  }

  /** Opening balances typed in, previewed like an import. Writes nothing to the books. */
  @Post('manual')
  @RequirePermission(Permission.MANAGE_ORG)
  manual(@Request() req: AuthRequest, @Body() body: ManualOpeningDto) {
    return this.migration.manual(req.user.orgId, req.user.sub, body);
  }

  @Get(':id')
  @RequirePermission(Permission.MANAGE_ORG)
  get(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.migration.get(req.user.orgId, id);
  }

  /** Create the accounts and parties, and post the opening balances. Once. */
  @Post(':id/commit')
  @RequirePermission(Permission.MANAGE_ORG)
  commit(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: CommitImportDto) {
    return this.migration.commit(req.user.orgId, req.user.sub, id, body);
  }
}
