import { Schema, Query } from 'mongoose';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Tenant context is stored per-request via AsyncLocalStorage.
 * The auth middleware populates it; the plugins read it.
 *
 * Two independent scoping axes live here:
 *   • orgId  — one company's books (Invariant 5). Used by every accounting model.
 *   • firmId — one CA firm's practice: its client book, leads, deadlines, tasks.
 *              A lead has no orgId at all, so CRM models cannot be org-scoped.
 *
 * NEITHER is ever accepted from the client body, query string or headers —
 * both come only from the verified JWT.
 */
export interface TenantContext {
  orgId?: string;
  firmId?: string;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

/** Run `fn` scoped to an org, preserving any surrounding firm scope. */
export function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ ...tenantContext.getStore(), orgId }, fn);
}

/** Run `fn` scoped to a firm, preserving any surrounding org scope. */
export function withFirm<T>(firmId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ ...tenantContext.getStore(), firmId }, fn);
}

type TenantQuery = Query<unknown, { orgId?: string }>;

/**
 * Global Mongoose plugin that auto-injects { orgId } into every
 * find / findOne / update / delete / count for tenant-scoped models.
 *
 * Apply via: schema.plugin(tenantIsolationPlugin)
 * on every tenant-scoped schema.
 */
export function tenantIsolationPlugin(schema: Schema): void {
  const queryOps = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'countDocuments',
  ] as const;

  for (const op of queryOps) {
    schema.pre(op, function (this: TenantQuery) {
      const ctx = tenantContext.getStore();
      if (!ctx?.orgId) return; // No context — system job or test outside request scope

      const filter = this.getFilter() as Record<string, unknown>;
      if (!filter['orgId']) {
        this.where({ orgId: ctx.orgId });
      }
    });
  }

  // Inject orgId on new documents.
  //
  // This MUST hook 'validate', not 'save'. Mongoose runs pre('validate') →
  // validate → pre('save') → save, and every tenant-scoped schema declares
  // `orgId: { required: true }` — so injecting at pre('save') happens after
  // validation has already rejected the document.
  schema.pre('validate', function (this: { orgId?: string }) {
    const ctx = tenantContext.getStore();
    if (ctx?.orgId && !this.orgId) {
      this.orgId = ctx.orgId;
    }
  });
}

type FirmQuery = Query<unknown, { firmId?: string }>;

/**
 * Global Mongoose plugin that auto-injects { firmId } into every
 * find / findOne / update / delete / count for firm-scoped models.
 *
 * This is the CRM's equivalent of tenantIsolationPlugin: a CA firm's leads,
 * compliance items, document requests, practice invoices, tasks and
 * conversations span its whole client book, so they cannot be keyed by orgId.
 *
 * Apply via: schema.plugin(firmIsolationPlugin)
 * on every firm-scoped schema.
 */
export function firmIsolationPlugin(schema: Schema): void {
  const queryOps = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'countDocuments',
  ] as const;

  for (const op of queryOps) {
    schema.pre(op, function (this: FirmQuery) {
      const ctx = tenantContext.getStore();
      if (!ctx?.firmId) return; // No context — system job or test outside request scope

      const filter = this.getFilter() as Record<string, unknown>;
      if (!filter['firmId']) {
        this.where({ firmId: ctx.firmId });
      }
    });
  }

  // Inject firmId on new documents — at 'validate', for the same reason as
  // the orgId plugin above: firm-scoped schemas declare firmId as required,
  // and pre('save') runs after validation has already rejected the document.
  schema.pre('validate', function (this: { firmId?: string }) {
    const ctx = tenantContext.getStore();
    if (ctx?.firmId && !this.firmId) {
      this.firmId = ctx.firmId;
    }
  });
}
