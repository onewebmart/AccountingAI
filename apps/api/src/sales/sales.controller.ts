import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Permission, InvoiceStatus } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CustomersService, CreateCustomerInput } from './customers.service';
import { SalesInvoicesService, CreateInvoiceInput } from './sales-invoices.service';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('sales')
export class SalesController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly invoicesService: SalesInvoicesService,
  ) {}

  // ── Customers ────────────────────────────────────────────────────────────

  @Get('customers')
  @RequirePermission(Permission.MANAGE_SALES)
  listCustomers(@Request() req: AuthRequest) {
    return this.customersService.list(req.user.orgId);
  }

  @Post('customers')
  @RequirePermission(Permission.MANAGE_SALES)
  createCustomer(@Request() req: AuthRequest, @Body() body: Omit<CreateCustomerInput, 'orgId'>) {
    return this.customersService.create({ ...body, orgId: req.user.orgId });
  }

  @Get('customers/:id')
  @RequirePermission(Permission.MANAGE_SALES)
  getCustomer(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.customersService.findById(id, req.user.orgId);
  }

  @Get('customers/:id/receivable')
  @RequirePermission(Permission.MANAGE_SALES)
  customerReceivable(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.customersService.receivable(id, req.user.orgId).then((paise) => ({ paise }));
  }

  @Get('ar-ageing')
  @RequirePermission(Permission.MANAGE_SALES)
  arAgeing(@Request() req: AuthRequest) {
    return this.customersService.arAgeing(req.user.orgId);
  }

  // ── Invoices ─────────────────────────────────────────────────────────────

  @Get('invoices')
  @RequirePermission(Permission.MANAGE_SALES)
  listInvoices(@Request() req: AuthRequest, @Query('status') status?: InvoiceStatus) {
    return this.invoicesService.list(req.user.orgId, status);
  }

  @Post('invoices')
  @RequirePermission(Permission.MANAGE_SALES)
  createInvoice(@Request() req: AuthRequest, @Body() body: Omit<CreateInvoiceInput, 'orgId'>) {
    return this.invoicesService.create({ ...body, orgId: req.user.orgId });
  }

  @Get('invoices/:id')
  @RequirePermission(Permission.MANAGE_SALES)
  getInvoice(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.invoicesService.findById(id, req.user.orgId);
  }

  @Post('invoices/:id/send')
  @RequirePermission(Permission.MANAGE_SALES)
  sendInvoice(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.invoicesService.send(id, req.user.orgId, req.user.sub);
  }

  @Post('invoices/:id/post')
  @RequirePermission(Permission.POST_JOURNAL)
  postInvoice(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.invoicesService.post(id, req.user.orgId, req.user.sub);
  }

  @Post('invoices/:id/pay')
  @RequirePermission(Permission.POST_JOURNAL)
  payInvoice(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.invoicesService.markPaid(id, req.user.orgId, req.user.sub);
  }
}
