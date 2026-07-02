import { Schema, Query } from 'mongoose';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Tenant context is stored per-request via AsyncLocalStorage.
 * The auth middleware populates it; the plugin reads it.
 * OrgId is NEVER accepted from the client body — only from the verified JWT.
 */
export const tenantContext = new AsyncLocalStorage<{ orgId: string }>();

export function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run({ orgId }, fn);
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

  // Inject orgId on document save for new documents
  schema.pre('save', function (this: { orgId?: string }) {
    const ctx = tenantContext.getStore();
    if (ctx?.orgId && !this.orgId) {
      this.orgId = ctx.orgId;
    }
  });
}
