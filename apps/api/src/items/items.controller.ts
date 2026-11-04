import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { ItemsService } from './items.service';
import { CreateItemDto, SuggestHsnDto, UpdateItemDto } from './dto/items.dto';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('items')
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequirePermission(Permission.MANAGE_SALES)
  list(@Request() req: AuthRequest, @Query('q') q?: string, @Query('archived') archived?: string) {
    return this.items.list(req.user.orgId, { q, includeArchived: archived === 'true' });
  }

  @Post()
  @RequirePermission(Permission.MANAGE_SALES)
  create(@Request() req: AuthRequest, @Body() body: CreateItemDto) {
    return this.items.create(req.user.orgId, req.user.sub, body);
  }

  /** History, then a rule, then the model in a job. Advice only: nothing is saved to the item. */
  @Post('suggest-hsn')
  @RequirePermission(Permission.MANAGE_SALES)
  suggest(@Request() req: AuthRequest, @Body() body: SuggestHsnDto) {
    return this.items.suggestHsn(req.user.orgId, req.user.sub, body);
  }

  @Get('suggestions/:id')
  @RequirePermission(Permission.MANAGE_SALES)
  suggestion(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.items.suggestion(req.user.orgId, id);
  }

  @Get(':id')
  @RequirePermission(Permission.MANAGE_SALES)
  get(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.items.findById(req.user.orgId, id);
  }

  @Patch(':id')
  @RequirePermission(Permission.MANAGE_SALES)
  update(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: UpdateItemDto) {
    return this.items.update(req.user.orgId, req.user.sub, id, body);
  }

  @Post(':id/archive')
  @RequirePermission(Permission.MANAGE_SALES)
  archive(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.items.setActive(req.user.orgId, req.user.sub, id, false);
  }

  @Post(':id/restore')
  @RequirePermission(Permission.MANAGE_SALES)
  restore(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.items.setActive(req.user.orgId, req.user.sub, id, true);
  }
}
