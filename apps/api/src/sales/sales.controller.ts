import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Permission, InvoiceStatus } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CustomersService } from './customers.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { CreateCustomerDto, CreateSalesInvoiceDto, PayInvoiceDto, CreateCreditNoteDto, UpdateCustomerDto, EmailInvoiceDto } from './dto/sales.dto';
import { CreditNotesService } from './credit-notes.service';
import { InvoiceDeliveryService } from './invoice-delivery.service';
import { Response } from 'express';

import { ItemsService } from '../items/items.service';
interface AuthRequest {
  user: { orgId: string; sub: string };
}

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('sales')
export class SalesController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly invoicesService: SalesInvoicesService,
    private readonly creditNotesService: CreditNotesService,
    private readonly delivery: InvoiceDeliveryService,
    private readonly items: ItemsService,
  ) {}

  // ── Customers ────────────────────────────────────────────────────────────

  @Get('customers')
  @RequirePermission(Permission.MANAGE_SALES)
  listCustomers(@Request() req: AuthRequest) {
    return this.customersService.list(req.user.orgId);
  }

  @Post('customers')
  @RequirePermission(Permission.MANAGE_SALES)
  createCustomer(@Request() req: AuthRequest, @Body() body: CreateCustomerDto) {
    return this.customersService.create({ ...body, orgId: req.user.orgId, actorId: req.user.sub });
  }

  @Get('customers/:id')
  @RequirePermission(Permission.MANAGE_SALES)
  getCustomer(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.customersService.findById(id, req.user.orgId);
  }

  @Patch('customers/:id')
  @RequirePermission(Permission.MANAGE_SALES)
  updateCustomer(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: UpdateCustomerDto) {
    return this.customersService.update(id, req.user.orgId, req.user.sub, body);
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
  async createInvoice(@Request() req: AuthRequest, @Body() body: CreateSalesInvoiceDto) {
    const lineItems = await this.items.resolveLines(req.user.orgId, body.lineItems, 'sale');
    return this.invoicesService.create({ ...body, lineItems, orgId: req.user.orgId, actorId: req.user.sub });
  }

  @Get('invoices/:id')
  @RequirePermission(Permission.MANAGE_SALES)
  getInvoice(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.invoicesService.findById(id, req.user.orgId);
  }

  /** The invoice as a PDF, as the customer would get it. */
  @Get('invoices/:id/pdf')
  @RequirePermission(Permission.MANAGE_SALES)
  async invoicePdf(@Request() req: AuthRequest, @Param('id') id: string, @Res() res: Response) {
    const { filename, content } = await this.delivery.pdf(req.user.orgId, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(content);
  }

  /** Email the PDF to the customer. */
  @Post('invoices/:id/email')
  @RequirePermission(Permission.MANAGE_SALES)
  emailInvoice(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: EmailInvoiceDto) {
    return this.delivery.email(req.user.orgId, req.user.sub, id, body);
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
  payInvoice(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: PayInvoiceDto) {
    return this.invoicesService.markPaid(id, req.user.orgId, req.user.sub, body?.paidOn, body?.amountPaise, body?.tdsPaise);
  }

  /** Raise and post a credit note against a posted invoice — Dr/Cr in proportion, numbered by its voucher. */
  @Post('invoices/:id/credit-notes')
  @RequirePermission(Permission.POST_JOURNAL)
  createCreditNote(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: CreateCreditNoteDto) {
    return this.creditNotesService.create(id, req.user.orgId, req.user.sub, body);
  }

  @Get('credit-notes')
  @RequirePermission(Permission.MANAGE_SALES)
  listCreditNotes(@Request() req: AuthRequest, @Query('invoiceId') invoiceId?: string) {
    return this.creditNotesService.list(req.user.orgId, invoiceId);
  }
}
