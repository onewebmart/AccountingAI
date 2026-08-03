import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
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
      balancePaise: 0,
    };
  }
}
