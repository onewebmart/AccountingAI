import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AccountType, Permission } from '@ai-accounting/shared';
import { CurrentUser, JwtPayload, RequirePermission } from '../auth/decorators';
import { AccountsService } from './accounts.service';

interface CreateAccountBody {
  name?: string;
  type?: AccountType;
  code?: string;
  parentId?: string | null;
  isGroup?: boolean;
}

interface UpdateAccountBody {
  name?: unknown;
  code?: unknown;
  parentId?: unknown;
  isActive?: unknown;
}

@Controller('gl')
export class GlController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('accounts')
  @RequirePermission(Permission.VIEW_JOURNAL)
  list(@CurrentUser() user: JwtPayload) {
    return this.accounts.list(user.orgId);
  }

  @Post('accounts')
  @RequirePermission(Permission.MANAGE_COA)
  async create(@CurrentUser() user: JwtPayload, @Body() body: CreateAccountBody) {
    if (!body.name?.trim()) throw new BadRequestException('Account name is required.');
    if (!body.type || !Object.values(AccountType).includes(body.type)) {
      throw new BadRequestException('A valid account type is required.');
    }

    const account = await this.accounts.create({
      orgId: user.orgId,
      actorId: user.sub,
      name: body.name,
      type: body.type,
      code: body.code,
      parentId: body.parentId ?? null,
      isGroup: body.isGroup,
    });

    return {
      _id: account._id.toString(),
      name: account.name,
      code: account.code,
      type: account.type,
      parentId: account.parentId ? account.parentId.toString() : null,
      isGroup: account.isGroup,
      isSystem: account.isSystem,
      isActive: true,
      balancePaise: 0,
    };
  }

  /** Rename, recode, move under another group, or (de)activate. Only the fields sent change. */
  @Patch('accounts/:id')
  @RequirePermission(Permission.MANAGE_COA)
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: UpdateAccountBody) {
    const str = (v: unknown, field: string) => {
      if (v === undefined) return undefined;
      if (typeof v !== 'string') throw new BadRequestException(`${field} must be text.`);
      return v;
    };
    if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== 'string') {
      throw new BadRequestException('parentId must be a group id or null.');
    }
    if (body.isActive !== undefined && typeof body.isActive !== 'boolean') throw new BadRequestException('isActive must be true or false.');
    return this.accounts.update(user.orgId, user.sub, id, {
      name: str(body.name, 'name'),
      code: str(body.code, 'code'),
      parentId: body.parentId as string | null | undefined,
      isActive: body.isActive as boolean | undefined,
    });
  }
}
