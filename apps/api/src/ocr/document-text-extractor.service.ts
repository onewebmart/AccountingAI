import { Injectable, Logger } from '@nestjs/common';
import * as mammoth from 'mammoth';

/** Word documents. Only the modern zipped XML format can be read natively. */
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const LEGACY_DOC_MIME = 'application/msword';

const PLAIN_TEXT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/rtf',
  'application/rtf',
]);

export interface NativeTextResult {
  text: string;
  /** What produced the text — recorded on the OcrResult for traceability. */
  source: 'docx' | 'plain-text';
}

/**
 * Extracts text from documents that already CONTAIN text, so they never need OCR:
 * Word (.docx) and plain-text formats (.txt, .md, .rtf).
 *
 * These bypass the OCR cascade entirely — running a vision model over a file whose
 * bytes already spell out the words would cost money and lose accuracy.
 */
@Injectable()
export class DocumentTextExtractorService {
  private readonly logger = new Logger(DocumentTextExtractorService.name);

  /** True when this file carries extractable text without OCR. */
  static isNativeText(mimeType: string, fileName = ''): boolean {
    if (mimeType === DOCX_MIME || PLAIN_TEXT_MIMES.has(mimeType)) return true;
    return /\.(docx|txt|md|rtf)$/i.test(fileName);
  }

  /** True for the legacy binary .doc format, which needs conversion first. */
  static isLegacyDoc(mimeType: string, fileName = ''): boolean {
    return mimeType === LEGACY_DOC_MIME || /\.doc$/i.test(fileName);
  }

  async extract(
    buffer: Buffer,
    mimeType: string,
    fileName = '',
  ): Promise<NativeTextResult> {
    if (DocumentTextExtractorService.isLegacyDoc(mimeType, fileName)) {
      // mammoth reads the zipped OOXML format only. Rather than emit garbled
      // binary as if it were text, fail loudly with an actionable message.
      throw new Error(
        'Legacy .doc files are not supported. Save the file as .docx (or PDF) and upload again.',
      );
    }

    const isDocx = mimeType === DOCX_MIME || /\.docx$/i.test(fileName);

    if (isDocx) {
      const { value, messages } = await mammoth.extractRawText({ buffer });
      if (messages.length) {
        this.logger.debug(`mammoth notes for ${fileName || 'docx'}: ${messages.length} message(s)`);
      }
      return { text: normalise(value), source: 'docx' };
    }

    // Plain text / markdown / rtf. Strip a UTF-8 BOM if present.
    return { text: normalise(buffer.toString('utf8').replace(/^﻿/, '')), source: 'plain-text' };
  }
}

/** Collapse the whitespace churn these formats produce, without losing line structure. */
function normalise(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
