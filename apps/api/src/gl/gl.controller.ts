import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AccountType, Permission } from '@ai-accounting/shared';
import { CurrentUser, JwtPayload, RequirePermission } from '../auth/decorators';
import { AccountsService } from './accounts.service';
import { ACCOUNT_SUBTYPES, isAccountSubtype } from './account-subtypes';

interface CreateAccountBody {
  name?: string;
  type?: AccountType;
  /** The detailed type (bank, input_tax, cost_of_goods_sold…); the base type follows from it. */
  accountType?: unknown;
  code?: string;
  parentId?: string | null;
  isGroup?: boolean;
  description?: unknown;
  watchlist?: unknown;
}

interface UpdateAccountBody {
  name?: unknown;
  code?: unknown;
  parentId?: unknown;
  isActive?: unknown;
  accountType?: unknown;
  description?: unknown;
  watchlist?: unknown;
}

const subtype = (v: unknown) => {
  if (v === undefined) return undefined;
  if (!isAccountSubtype(v)) throw new BadRequestException('Choose an account type from the list.');
  return v;
};

@Controller('gl')
export class GlController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('accounts')
  @RequirePermission(Permission.VIEW_JOURNAL)
  list(@CurrentUser() user: JwtPayload) {
    return this.accounts.list(user.orgId);
  }

  /** The detailed account types, each with the base type its reports use. */
  @Get('account-types')
  @RequirePermission(Permission.VIEW_JOURNAL)
  accountTypes() {
    return Object.entries(ACCOUNT_SUBTYPES).map(([key, t]) => ({ key, label: t.label, base: t.base }));
  }

  @Post('accounts')
  @RequirePermission(Permission.MANAGE_COA)
  async create(@CurrentUser() user: JwtPayload, @Body() body: CreateAccountBody) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new BadRequestException('Account name is required.');
    const accountType = subtype(body.accountType);
    if (!accountType && (!body.type || !Object.values(AccountType).includes(body.type))) {
      throw new BadRequestException('A valid account type is required.');
    }
    if (body.description !== undefined && typeof body.description !== 'string') throw new BadRequestException('description must be text.');
    if (body.watchlist !== undefined && typeof body.watchlist !== 'boolean') throw new BadRequestException('watchlist must be true or false.');

    const account = await this.accounts.create({
      orgId: user.orgId,
      actorId: user.sub,
      name: body.name,
      type: body.type,
      accountType,
      code: body.code,
      parentId: body.parentId ?? null,
      isGroup: body.isGroup,
      description: body.description as string | undefined,
      watchlist: body.watchlist as boolean | undefined,
    });

    return {
      _id: account._id.toString(),
      name: account.name,
      code: account.code,
      type: account.type,
      accountType: account.accountType,
      parentId: account.parentId ? account.parentId.toString() : null,
      isGroup: account.isGroup,
      isSystem: account.isSystem,
      isActive: true,
      balancePaise: 0,
      description: account.description ?? '',
      watchlist: account.watchlist === true,
    };
  }

  /** Rename, recode, retype within the base type, move under another group, watch, or (de)activate. Only the fields sent change. */
  @Patch('accounts/:id')
  @RequirePermission(Permission.MANAGE_COA)
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: UpdateAccountBody) {
    const str = (v: unknown, field: string) => {
      if (v === undefined) return undefined;
      if (typeof v !== 'string') throw new BadRequestException(`${field} must be text.`);
      return v;
    };
    const bool = (v: unknown, field: string) => {
      if (v === undefined) return undefined;
      if (typeof v !== 'boolean') throw new BadRequestException(`${field} must be true or false.`);
      return v;
    };
    if (body.parentId !== undefined && body.parentId !== null && typeof body.parentId !== 'string') {
      throw new BadRequestException('parentId must be a group id or null.');
    }
    return this.accounts.update(user.orgId, user.sub, id, {
      name: str(body.name, 'name'),
      code: str(body.code, 'code'),
      parentId: body.parentId as string | null | undefined,
      isActive: bool(body.isActive, 'isActive'),
      accountType: subtype(body.accountType),
      description: str(body.description, 'description'),
      watchlist: bool(body.watchlist, 'watchlist'),
    });
  }
}
