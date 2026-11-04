/**
 * What the document pipeline can read: shared by uploads, email-in and
 * WhatsApp-in, so a file is accepted or refused the same way however it came.
 */

export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/heic',
  'image/heif',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
  // Word + plain text — read natively at Tier 0, never sent to OCR.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/rtf',
  'application/rtf',
]);

/** Some browsers send text/plain or an empty type for .csv/.docx — trust the extension too. */
export const ALLOWED_EXTENSIONS = /\.(pdf|jpe?g|png|webp|tiff?|heic|heif|xlsx?|csv|docx|txt|md|rtf)$/i;

export const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  csv: 'text/csv',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  rtf: 'application/rtf',
};


export const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Formats we recognise but cannot read, and what to do instead.
 *
 * A bare "File type X is not supported" leaves someone holding a supplier's
 * bill with nowhere to go. These are the formats a bill plausibly arrives in,
 * each with the one action that gets it in.
 */
const CONVERSION_HINTS: Array<[RegExp, string]> = [
  [/\.doc$/i, 'Legacy .doc files cannot be read. Open it in Word and use Save As → .docx, then upload again.'],
  [/\.odt$/i, 'OpenDocument text is not supported. Export it as .docx or print it to PDF, then upload again.'],
  [/\.ods$/i, 'OpenDocument spreadsheets are not supported. Export it as .xlsx or .csv, then upload again.'],
  [/\.pages$/i, 'Apple Pages files are not supported. Export it as PDF or .docx, then upload again.'],
  [/\.numbers$/i, 'Apple Numbers files are not supported. Export it as .xlsx or .csv, then upload again.'],
  [/\.(zip|rar|7z)$/i, 'Archives are not read. Extract it and upload the bills individually.'],
];

export function rejectionMessage(originalName: string, mimeType: string): string {
  for (const [pattern, hint] of CONVERSION_HINTS) {
    if (pattern.test(originalName)) return hint;
  }
  return (
    `Files of type "${mimeType || 'unknown'}" are not supported. ` +
    'Upload a PDF, photo, Word document, spreadsheet or plain text file.'
  );
}

/** Whether the pipeline can read a file, by its type or, failing that, its name. */
export function isAcceptedFile(mimeType: string, fileName: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType) || ALLOWED_EXTENSIONS.test(fileName);
}
