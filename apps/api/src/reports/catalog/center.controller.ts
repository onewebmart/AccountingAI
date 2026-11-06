import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Request, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { Allow, ArrayMaxSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { Response } from 'express';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import { ReportCatalogService } from '../report-catalog.service';
import { ReportCenterService } from './center.service';
import { renderReportXlsx } from './report-xlsx';
import { CenterParamsDto, REPORT_KEY as KEY } from './params.dto';
import type { FilterKind } from './types';
import type { ReportCondition } from '../schemas/custom-report.schema';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

class ConditionDto implements ReportCondition {
  @Matches(/^[A-Za-z0-9_]{1,64}$/) field: string;
  @IsIn(['contains', 'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'is_true', 'is_false']) op: ReportCondition['op'];
  // Text, whole paise or a date: checked against the field's kind in the service.
  @Allow() value: string | number | null;
}

class CustomReportDto {
  @IsString() @Length(2, 120) name: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string | null;
  @IsIn(['derived', 'module']) kind: 'derived' | 'module';
  @IsOptional() @Matches(/^[a-z0-9_]{2,64}$/) baseKey?: string | null;
  @IsOptional() @Matches(/^[a-z_]{2,32}$/) module?: string | null;
  @IsOptional() @IsObject() params?: Record<string, string>;
  @IsOptional() @IsIn(['last_month', 'this_month', 'last_quarter', 'this_fy', 'last_fy', null]) period?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) columns?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ConditionDto) conditions?: ConditionDto[];
  @IsOptional() @Matches(/^[A-Za-z0-9_]{1,64}$/) groupBy?: string | null;
  @IsOptional() @IsBoolean() groupTotalsOnly?: boolean;
  @IsOptional() @Matches(/^[A-Za-z0-9_]{1,64}$/) sortBy?: string | null;
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
  @IsOptional() @IsBoolean() shared?: boolean;
}

class FavouriteDto {
  @IsBoolean() favourite: boolean;
}

/** The Reports Center: the list, favourites and visits, custom reports, filter choices, and Excel downloads. */
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission(Permission.VIEW_REPORTS)
@Controller('reports')
export class ReportCenterController {
  constructor(
    private readonly catalog: ReportCatalogService,
    private readonly center: ReportCenterService,
  ) {}

  private base(req: AuthRequest) {
    return this.catalog.base(req.user.orgId, req.user.sub);
  }

  private key(key: string) {
    if (!KEY.test(key ?? '')) throw new BadRequestException('No such report.');
    return key;
  }

  @Get('center')
  list(@Request() req: AuthRequest) {
    return this.center.center(req.user.orgId, req.user.sub, this.base(req));
  }

  @Get('definition/:key')
  definition(@Request() req: AuthRequest, @Param('key') key: string) {
    return this.center.definition(req.user.orgId, req.user.sub, this.key(key), this.base(req));
  }

  @Put('favourites/:key')
  favourite(@Request() req: AuthRequest, @Param('key') key: string, @Body() body: FavouriteDto) {
    return this.center.setFavourite(req.user.orgId, req.user.sub, this.key(key), body.favourite, this.base(req));
  }

  @Post('visits/:key')
  visit(@Request() req: AuthRequest, @Param('key') key: string) {
    return this.center.visit(req.user.orgId, req.user.sub, this.key(key), this.base(req));
  }

  @Get('options/:kind')
  options(@Request() req: AuthRequest, @Param('kind') kind: string) {
    if (!['customer', 'vendor', 'account', 'money_account', 'project', 'item', 'user'].includes(kind)) throw new BadRequestException('No such list.');
    return this.center.options(req.user.orgId, kind as FilterKind);
  }

  @Get('modules')
  modules() {
    return this.center.modules();
  }

  @Get('custom')
  customList(@Request() req: AuthRequest) {
    return this.center.listCustom(req.user.orgId, req.user.sub);
  }

  @Post('custom/preview')
  preview(@Request() req: AuthRequest, @Body() body: CustomReportDto, @Query() q: CenterParamsDto) {
    return this.center.preview(req.user.orgId, body, q, this.base(req));
  }

  @Get('custom/:id')
  custom(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.center.getCustom(req.user.orgId, req.user.sub, id);
  }

  @Post('custom')
  create(@Request() req: AuthRequest, @Body() body: CustomReportDto) {
    return this.center.createCustom(req.user.orgId, req.user.sub, body, this.base(req));
  }

  @Put('custom/:id')
  update(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: CustomReportDto) {
    return this.center.updateCustom(req.user.orgId, req.user.sub, id, body, this.base(req));
  }

  @Delete('custom/:id')
  remove(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.center.deleteCustom(req.user.orgId, req.user.sub, id);
  }

  @Get('run/:key/xlsx')
  async xlsx(@Request() req: AuthRequest, @Param('key') key: string, @Query() q: CenterParamsDto, @Res() res: Response) {
    const table = await this.catalog.run(req.user.orgId, this.key(key), q, req.user.sub);
    const buffer = await renderReportXlsx(table, await this.catalog.org(req.user.orgId));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${key.replace(/[._]/g, '-')}.xlsx"`);
    res.send(buffer);
  }
}
