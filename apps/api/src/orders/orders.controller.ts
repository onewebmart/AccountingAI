import { Body, Controller, Get, Param, Patch, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsInt, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Min, ValidateNested } from 'class-validator';
import { Response } from 'express';
import { Permission } from '@ai-accounting/shared';
import { RequirePermission } from '../auth/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { SalesDocsService } from './sales-docs.service';

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

class QuoteDto {
  @IsMongoId() customerId: string;
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @Matches(DATE) validUntil?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DocLineDto) lines: DocLineDto[];
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
}

class QuoteUpdateDto {
  @IsOptional() @Matches(DATE) validUntil?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DocLineDto) lines?: DocLineDto[];
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
}

class SendDto {
  @IsOptional() @IsEmail() to?: string | null;
}

class FromMessageDto {
  @IsMongoId() customerId: string;
  @IsString() @Length(1, 5000) text: string;
}

class OrderDto {
  @IsMongoId() customerId: string;
  @IsOptional() @Matches(DATE) date?: string;
  @IsOptional() @Matches(DATE) expectedBy?: string | null;
  @IsOptional() @IsString() @Length(0, 60) customerPoNumber?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DocLineDto) lines: DocLineDto[];
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
}

class PickDto {
  @IsInt() @Min(0) orderLine: number;
  @IsNumber() @Min(0) qty: number;
}

class InvoiceOrderDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PickDto) lines: PickDto[];
}

class ChallanDto {
  @IsMongoId() customerId: string;
  @IsOptional() @Matches(DATE) date?: string;
  @IsIn(['supply', 'job_work', 'approval', 'other']) reason: 'supply' | 'job_work' | 'approval' | 'other';
  @IsOptional() @IsMongoId() salesOrderId?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => DocLineDto) lines: DocLineDto[];
  @IsOptional() @IsString() @Length(0, 20) vehicleNo?: string | null;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string | null;
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

  @Post('challans')
  createChallan(@Request() req: AuthRequest, @Body() body: ChallanDto) {
    return this.docs.createChallan(req.user.orgId, req.user.sub, body);
  }

  @Post('challans/:id/:action')
  challanStatus(@Request() req: AuthRequest, @Param('id') id: string, @Param('action') action: string) {
    return this.docs.setChallanStatus(req.user.orgId, req.user.sub, id, action === 'cancel' ? 'cancelled' : 'returned');
  }

  @Get(':kind/:id/pdf')
  async pdf(@Request() req: AuthRequest, @Param('kind') kind: string, @Param('id') id: string, @Res() res: Response) {
    const k = kind === 'quotes' ? 'quote' : kind === 'sales-orders' ? 'sales_order' : 'challan';
    const { filename, content } = await this.docs.pdf(req.user.orgId, k, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(content);
  }
}
