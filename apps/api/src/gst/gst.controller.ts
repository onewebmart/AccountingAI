import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Param,
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
  ) {}

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
