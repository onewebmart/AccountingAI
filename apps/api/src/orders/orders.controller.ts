import { Body, Controller, Get, Param, Patch, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Response } from 'express';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { SalesDocsService } from './sales-docs.service';
import { DocWordsDto, PricedDocDto } from './doc-extras.dto';
import { CHALLAN_REASONS, ChallanReason } from './schemas/sales-docs.schema';

interface AuthRequest {
  user: { orgId: string; sub: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DocLineDto {
  @IsString() @Length(1, 500) description: string;
  @IsOptional() @IsMongoId() itemId?: string | null;
  @IsOptional() @IsString() @Length(0, 8) hsnSac?: string | null;
  @IsOptional() @IsString() @Length(0, 3) uqc?: string | null;
  @IsNumber() @Min(0) qty: number;
  @IsInt() @Min(0) ratePaise: number;
  @IsInt() @Min(0) taxRatePct: number;
  /** Challans against an order: the order line delivered. */
  @IsOptional() @IsInt() @Min(0) orderLine?: number | null;
}

class QuoteDto extends PricedDocDto {
  @IsMongoId() customerId: string;
  /** Typed by a person; blank takes the next QT number. */
  @IsOptional() @IsString() @Length(0, 16) number?: string | null;
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @Matches(DATE) validUntil?: string;
  @IsOptional() @IsMongoId() projectId?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DocLineDto) lines: DocLineDto[];
  @IsOptional() @IsString() @Length(0, 2000) notes?: string | null;
}

class QuoteUpdateDto extends PricedDocDto {
  @IsOptional() @Matches(DATE) validUntil?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DocLineDto) lines?: DocLineDto[];
  @IsOptional() @IsString() @Length(0, 2000) notes?: string | null;
}

class SendDto {
  @IsOptional() @IsEmail() to?: string | null;
}

class FromMessageDto {
  @IsMongoId() customerId: string;
  @IsString() @Length(1, 5000) text: string;
}

class OrderDto extends PricedDocDto {
  @IsMongoId() customerId: string;
  /** Typed by a person; blank takes the next SO number. */
  @IsOptional() @IsString() @Length(0, 16) number?: string | null;
  @IsOptional() @Matches(DATE) date?: string;
  /** The expected shipment date. */
  @IsOptional() @Matches(DATE) expectedBy?: string | null;
  /** The order's reference: the customer's PO number. */
  @IsOptional() @IsString() @Length(0, 60) customerPoNumber?: string | null;
  @IsOptional() @IsString() @Length(0, 60) deliveryMethod?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(365) paymentTermsDays?: number | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DocLineDto) lines: DocLineDto[];
  @IsOptional() @IsString() @Length(0, 2000) notes?: string | null;
}

class PickDto {
  @IsInt() @Min(0) orderLine: number;
  @IsNumber() @Min(0) qty: number;
}

class InvoiceOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PickDto) lines: PickDto[];
}

class ChallanDto extends DocWordsDto {
  @IsMongoId() customerId: string;
  /** Typed by a person; blank takes the next DC number. */
  @IsOptional() @IsString() @Length(0, 16) number?: string | null;
  @IsOptional() @Matches(DATE) date?: string;
  /** The challan type: why the goods move (rule 55). */
  @IsIn([...CHALLAN_REASONS]) reason: ChallanReason;
  @IsOptional() @IsMongoId() salesOrderId?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DocLineDto) lines: DocLineDto[];
  @IsOptional() @IsString() @Length(0, 20) vehicleNo?: string | null;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string | null;
}

/** Quotes, sales orders and delivery challans. None of them posts. */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('orders')
@RequirePermission(Permission.MANAGE_SALES)
export class OrdersController {
  constructor(private readonly docs: SalesDocsService) {}

  @Get('quotes')
  quotes(@Request() req: AuthRequest) {
    return this.docs.listQuotes(req.user.orgId);
  }

  @Post('quotes')
  createQuote(@Request() req: AuthRequest, @Body() body: QuoteDto) {
    return this.docs.createQuote(req.user.orgId, req.user.sub, body);
  }

  /** Draft a quote from a customer's email or WhatsApp. A person checks and sends it. */
  @Post('quotes/from-message')
  fromMessage(@Request() req: AuthRequest, @Body() body: FromMessageDto) {
    return this.docs.draftFromMessage(req.user.orgId, req.user.sub, body);
  }

  @Get('quotes/drafting/:id')
  drafting(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.docs.quoteDraftStatus(req.user.orgId, id);
  }

  @Get('quotes/follow-ups')
  followUps(@Request() req: AuthRequest) {
    return this.docs.followUps(req.user.orgId);
  }

  @Get('price')
  price(@Request() req: AuthRequest, @Query('customerId') customerId: string, @Query('itemId') itemId?: string, @Query('description') description?: string) {
    return this.docs.lastPrice(req.user.orgId, customerId, itemId || null, description || null);
  }

  // After the named quote routes (from-message, drafting, follow-ups), so they are not taken for an id.
  @Get('quotes/:id')
  quote(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.docs.getQuote(req.user.orgId, id);
  }

  @Patch('quotes/:id')
  updateQuote(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: QuoteUpdateDto) {
    return this.docs.updateQuote(req.user.orgId, req.user.sub, id, body);
  }

  @Post('quotes/:id/send')
  send(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: SendDto) {
    return this.docs.sendQuote(req.user.orgId, req.user.sub, id, body);
  }

  @Post('quotes/:id/accept')
  accept(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.docs.answerQuote(req.user.orgId, req.user.sub, id, 'accepted');
  }

  @Post('quotes/:id/decline')
  decline(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.docs.answerQuote(req.user.orgId, req.user.sub, id, 'declined');
  }

  @Post('quotes/:id/convert/:to')
  convert(@Request() req: AuthRequest, @Param('id') id: string, @Param('to') to: string) {
    return this.docs.convertQuote(req.user.orgId, req.user.sub, id, to === 'invoice' ? 'invoice' : 'sales_order');
  }

  @Get('sales-orders')
  orders(@Request() req: AuthRequest) {
    return this.docs.listOrders(req.user.orgId);
  }

  @Get('sales-orders/:id')
  order(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.docs.getOrder(req.user.orgId, id);
  }

  @Post('sales-orders')
  createOrder(@Request() req: AuthRequest, @Body() body: OrderDto) {
    return this.docs.createOrder(req.user.orgId, req.user.sub, body);
  }

  @Post('sales-orders/:id/invoice')
  invoiceOrder(@Request() req: AuthRequest, @Param('id') id: string, @Body() body: InvoiceOrderDto) {
    return this.docs.invoiceOrder(req.user.orgId, req.user.sub, id, body.lines);
  }

  @Post('sales-orders/:id/:action')
  orderStatus(@Request() req: AuthRequest, @Param('id') id: string, @Param('action') action: string) {
    return this.docs.setOrderStatus(req.user.orgId, req.user.sub, id, action === 'cancel' ? 'cancelled' : 'closed');
  }

  @Get('challans')
  challans(@Request() req: AuthRequest) {
    return this.docs.listChallans(req.user.orgId);
  }

  @Get('challans/:id')
  challan(@Request() req: AuthRequest, @Param('id') id: string) {
    return this.docs.getChallan(req.user.orgId, id);
  }

  @Post('challans')
  createChallan(@Request() req: AuthRequest, @Body() body: ChallanDto) {
    return this.docs.createChallan(req.user.orgId, req.user.sub, body);
  }

  @Post('challans/:id/:action')
  challanStatus(@Request() req: AuthRequest, @Param('id') id: string, @Param('action') action: string) {
    return this.docs.setChallanStatus(req.user.orgId, req.user.sub, id, action === 'cancel' ? 'cancelled' : 'returned');
  }

  // Named routes, not :kind/:id/pdf, which would also catch purchase-orders/:id/pdf.
  @Get('quotes/:id/pdf')
  quotePdf(@Request() req: AuthRequest, @Param('id') id: string, @Res() res: Response) {
    return this.sendPdf(req.user.orgId, 'quote', id, res);
  }

  @Get('sales-orders/:id/pdf')
  orderPdf(@Request() req: AuthRequest, @Param('id') id: string, @Res() res: Response) {
    return this.sendPdf(req.user.orgId, 'sales_order', id, res);
  }

  @Get('challans/:id/pdf')
  challanPdf(@Request() req: AuthRequest, @Param('id') id: string, @Res() res: Response) {
    return this.sendPdf(req.user.orgId, 'challan', id, res);
  }

  private async sendPdf(orgId: string, kind: 'quote' | 'sales_order' | 'challan', id: string, res: Response) {
    const { filename, content } = await this.docs.pdf(orgId, kind, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(content);
  }
}
