export * from './money';
export * from './enums';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AuditLogEntry {
  orgId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string;
  actorRole: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  impersonatedBy?: string;
  timestamp: Date;
}
