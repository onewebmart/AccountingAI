import { Permission, UserRole } from '../types/enums';

// Canonical map: every role → the set of permissions it holds.
// Server guards read this map; the UI uses it too for hiding controls.
// The server is the enforcer — UI hiding is convenience, not security.
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.PLATFORM_SUPER_ADMIN]: Object.values(Permission),

  [UserRole.FIRM_ADMIN]: [
    Permission.MANAGE_FIRM,
    Permission.MANAGE_USERS,
    Permission.MANAGE_ORG,
    Permission.VIEW_REPORTS,
    Permission.VIEW_JOURNAL,
    Permission.VIEW_DOCUMENT,
    Permission.VIEW_AUDIT,
  ],

  [UserRole.COMPANY_ADMIN]: [
    Permission.POST_JOURNAL,
    Permission.REVERSE_JOURNAL,
    Permission.VIEW_JOURNAL,
    Permission.UPLOAD_DOCUMENT,
    Permission.VIEW_DOCUMENT,
    Permission.REVIEW_PROPOSAL,
    Permission.APPROVE_PROPOSAL,
    Permission.VIEW_REPORTS,
    Permission.MANAGE_GST,
    Permission.MANAGE_ORG,
    Permission.MANAGE_USERS,
    Permission.MANAGE_COA,
    Permission.MANAGE_PURCHASE,
    Permission.MANAGE_SALES,
    Permission.VIEW_AUDIT,
  ],

  [UserRole.ACCOUNTANT]: [
    Permission.POST_JOURNAL,
    Permission.REVERSE_JOURNAL,
    Permission.VIEW_JOURNAL,
    Permission.UPLOAD_DOCUMENT,
    Permission.VIEW_DOCUMENT,
    Permission.REVIEW_PROPOSAL,
    Permission.APPROVE_PROPOSAL,
    Permission.VIEW_REPORTS,
    Permission.MANAGE_GST,
    Permission.MANAGE_COA,
    Permission.MANAGE_PURCHASE,
    Permission.MANAGE_SALES,
    Permission.VIEW_AUDIT,
  ],

  [UserRole.CA_REVIEWER]: [
    Permission.VIEW_JOURNAL,
    Permission.UPLOAD_DOCUMENT,
    Permission.VIEW_DOCUMENT,
    Permission.REVIEW_PROPOSAL,
    Permission.VIEW_REPORTS,
    Permission.MANAGE_GST,
    Permission.MANAGE_PURCHASE,
    Permission.MANAGE_SALES,
    Permission.VIEW_AUDIT,
  ],

  // Employees can upload and view — they CANNOT post journals
  [UserRole.EMPLOYEE]: [
    Permission.UPLOAD_DOCUMENT,
    Permission.VIEW_DOCUMENT,
    Permission.VIEW_REPORTS,
  ],

  [UserRole.AUDITOR]: [
    Permission.VIEW_JOURNAL,
    Permission.VIEW_DOCUMENT,
    Permission.VIEW_REPORTS,
    Permission.VIEW_AUDIT,
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
