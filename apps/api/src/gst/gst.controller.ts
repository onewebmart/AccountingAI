import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Param,
  ParseEnumPipe,
  Query,
  Body,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { RequirePermission } from '../auth/decorators';
import { Permission } from '@ai-accounting/shared';
import { GstService, ImportGstr2bLineDto } from './gst.service';
import { Gstr2bImportService } from './gstr2b-import.service';
import { GstReturnsService } from './gst-returns.service';
import { todayIst } from '../automation/schedule';
import { GstFilingService } from './gst-filing.service';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const RETURN_KINDS = { GSTR1: 'GSTR1', GSTR3B: 'GSTR3B' } as const;
type ReturnKind = keyof typeof RETURN_KINDS;

class FileReturnDto {
  @Matches(/^\d{6}$/, { message: 'Enter the six-digit OTP.' }) otp: string;
}

class GstPaymentDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) paidOn?: string;
  @IsOptional() @IsString() @Length(0, 30) challanNo?: string;
}

interface AuthRequest {
  user: { orgId: string; sub: string };
}

@Controller('gst')
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission(Permission.MANAGE_GST)
export class GstController {
  constructor(
    private readonly gstService: GstService,
    private readonly gstr2bImport: Gstr2bImportService,
    private readonly returns: GstReturnsService,
    private readonly filing: GstFilingService,
  ) {}

  // ── Returns ──────────────────────────────────────────────────────────────

  /** GSTR-1 for a month, table by table, with anything that would stop it filing. */
  @Get('returns/gstr1')
  gstr1(@Request() req: AuthRequest, @Query('period') period: string) {
    return this.returns.gstr1(req.user.orgId, period);
  }

  /** The same GSTR-1 in the GST offline tool's JSON shape. */
  @Get('returns/gstr1/json')
  gstr1Json(@Request() req: AuthRequest, @Query('period') period: string) {
    return this.returns.gstr1Json(req.user.orgId, period);
  }

  /** GSTR-3B for a month: liability, credit, and how the tax is paid. */
  @Get('returns/gstr3b')
  gstr3b(@Request() req: AuthRequest, @Query('period') period: string) {
    return this.returns.gstr3b(req.user.orgId, period);
  }

  @Get('returns/gstr3b/json')
  gstr3bJson(@Request() req: AuthRequest, @Query('period') period: string) {
    return this.returns.gstr3bJson(req.user.orgId, period);
  }

  // ── Filing through the GSP ────────────────────────────────────────────────

  @Get('filings')
  filings(@Request() req: AuthRequest, @Query('period') period: string) {
    return this.filing.status(req.user.orgId, period);
  }

  /** This month against the last six: what to look at before filing. */
  @Get('filings/:type/:period/review')
  review(@Request() req: AuthRequest, @Param('type', new ParseEnumPipe(RETURN_KINDS)) type: ReturnKind, @Param('period') period: string) {
    return this.filing.review(req.user.orgId, type, period);
  }

  @Post('filings/:type/:period/save')
  saveReturn(@Request() req: AuthRequest, @Param('type', new ParseEnumPipe(RETURN_KINDS)) type: ReturnKind, @Param('period') period: string) {
    return this.filing.save(req.user.orgId, req.user.sub, type, period);
  }

  @Post('filings/:type/:period/otp')
  filingOtp(@Request() req: AuthRequest, @Param('type', new ParseEnumPipe(RETURN_KINDS)) type: ReturnKind, @Param('period') period: string) {
    return this.filing.requestOtp(req.user.orgId, req.user.sub, type, period);
  }

  /** Final: the return goes to the portal under the business's GSTIN. */
  @Post('filings/:type/:period/file')
  fileReturn(@Request() req: AuthRequest, @Param('type', new ParseEnumPipe(RETURN_KINDS)) type: ReturnKind, @Param('period') period: string, @Body() body: FileReturnDto) {
    return this.filing.file(req.user.orgId, req.user.sub, type, period, body.otp);
  }

  /** The month's set-off and cash payment as one voucher: a posting, so it needs the right to post. */
  @Post('filings/GSTR3B/:period/payment')
  @RequirePermission(Permission.POST_JOURNAL)
  gstPayment(@Request() req: AuthRequest, @Param('period') period: string, @Body() body: GstPaymentDto) {
    return this.filing.recordPayment(req.user.orgId, req.user.sub, period, body);
  }

  @Get('returns/gstr9')
  gstr9(@Request() req: AuthRequest, @Query('fy') fy: string) {
    return this.filing.gstr9(req.user.orgId, fy);
  }

  /** Each mismatch between GSTR-2B and the books, explained, with the message for the vendor. */
  @Get('2b/explanations')
  explain2b(@Request() req: AuthRequest, @Query('period') period: string) {
    return this.returns.explain2b(req.user.orgId, period);
  }

  /** Bills to pay before their 180 days end, or lose the credit until paid (rule 37). */
  @Get('itc/rule37')
  rule37(@Request() req: AuthRequest, @Query('asOf') asOf?: string) {
    return this.returns.rule37Watchlist(req.user.orgId, asOf || todayIst());
  }

  @Get('purchase-register')
  getPurchaseRegister(
    @Request() req: AuthRequest,
    @Query('period') period: string,
    @Query('buyerStateCode') buyerStateCode: string,
  ) {
    return this.gstService.getPurchaseRegister(req.user.orgId, period, buyerStateCode);
  }

  @Get('sales-register')
  getSalesRegister(
    @Request() req: AuthRequest,
    @Query('period') period: string,
    @Query('buyerStateCode') buyerStateCode: string,
  ) {
    return this.gstService.getSalesRegister(req.user.orgId, period, buyerStateCode ?? '27');
  }

  @Post('import-2b')
  importGstr2b(
    @Request() req: AuthRequest,
    @Body() body: { period: string; lines: ImportGstr2bLineDto[] },
  ) {
    return this.gstService.importGstr2b(req.user.orgId, body.period, body.lines);
  }

  /**
   * Import a GSTR-2B straight from the portal download — either the JSON file or
   * the Excel/CSV export. Saves re-keying every inward invoice by hand.
   */
  @Post('import-2b/file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (/\.(json|xlsx?|csv)$/i.test(file.originalname)) cb(null, true);
        else cb(new BadRequestException('Upload the GSTR-2B JSON or Excel file.'), false);
      },
    }),
  )
  async importGstr2bFile(
    @Request() req: AuthRequest,
    @UploadedFile() file: Express.Multer.File,
    @Query('period') period?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided.');

    const parsed = await this.gstr2bImport.parse(file.buffer, file.originalname, period);
    const saved = await this.gstService.importGstr2b(
      req.user.orgId,
      parsed.period,
      parsed.lines,
    );

    return {
      period: parsed.period,
      imported: saved.length,
      warnings: parsed.warnings.slice(0, 20),
    };
  }

  @Post('reconcile-2b')
  reconcile2b(
    @Request() req: AuthRequest,
    @Query('period') period: string,
    @Query('buyerStateCode') buyerStateCode: string,
  ) {
    return this.gstService.reconcile2b(req.user.orgId, period, buyerStateCode);
  }

  @Get('recon-lines')
  getReconLines(@Request() req: AuthRequest, @Query('period') period: string) {
    return this.gstService.getReconLines(req.user.orgId, period);
  }

  @Get('itc-summary')
  getItcSummary(
    @Request() req: AuthRequest,
    @Query('period') period: string,
    @Query('buyerStateCode') buyerStateCode: string,
  ) {
    return this.gstService.getItcSummary(req.user.orgId, period, buyerStateCode);
  }

  @Post('recon-lines/:lineId/create-entry')
  createEntry(@Param('lineId') lineId: string, @Request() req: AuthRequest) {
    return this.gstService.createEntryFrom2bLine(lineId, req.user.orgId);
  }
}
