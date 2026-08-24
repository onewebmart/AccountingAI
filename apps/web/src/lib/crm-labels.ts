import { ClientType, FirmService } from '@ai-accounting/shared';

/**
 * Display labels for CRM enums.
 *
 * These live outside the page files on purpose: a Next.js App Router `page.tsx`
 * may only export `default` and a fixed set of route names, so exporting shared
 * constants from one is a build error.
 */

export interface Client {
  _id: string;
  name: string;
  gstin?: string;
  pan?: string;
  clientType?: ClientType;
  whatsappNumber?: string;
  contactEmail?: string;
  contactName?: string;
  services?: FirmService[];
  isActive: boolean;
}

export const SERVICE_LABELS: Record<FirmService, string> = {
  [FirmService.GST_FILING]: 'GST',
  [FirmService.ITR]: 'ITR',
  [FirmService.TDS]: 'TDS',
  [FirmService.ROC_MCA]: 'ROC',
  [FirmService.AUDIT]: 'Audit',
  [FirmService.BOOKKEEPING]: 'Bookkeeping',
};

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  [ClientType.INDIVIDUAL]: 'Individual',
  [ClientType.PROPRIETORSHIP]: 'Proprietorship',
  [ClientType.PARTNERSHIP]: 'Partnership',
  [ClientType.PRIVATE_LIMITED]: 'Private Limited',
  [ClientType.PUBLIC_LIMITED]: 'Public Limited',
  [ClientType.LLP]: 'LLP',
};
