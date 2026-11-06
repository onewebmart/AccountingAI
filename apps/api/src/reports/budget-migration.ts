import { Model } from 'mongoose';
import { AuditService } from '../gl/audit.service';
import { BudgetDocument } from './schemas/budget.schema';
import { NamedBudgetDocument } from './schemas/named-budget.schema';

export const MIGRATION_ACTOR = 'system:budget-migration';

/**
 * Before named budgets, an org had one budget per financial year, kept as
 * rows of the `budgets` collection. The first time an org's budgets are
 * read, each such year is copied into a named budget "Budget <year>", by
 * month, made that year's default unless the year has one. The old rows are
 * left as they were and nothing writes them again: the copy is the budget
 * from then on. `migratedFrom` marks the copy, so it is made once, even if
 * the copy is later archived or deleted, and even when reads race.
 */
export async function migrateLegacyBudgets(
  models: { legacy: Model<BudgetDocument>; named: Model<NamedBudgetDocument>; audit: AuditService },
  orgId: string,
): Promise<number> {
  const years = ((await models.legacy.distinct('financialYear', { orgId }).exec()) as string[]).sort();
  if (!years.length) return 0;
  const done = new Set(
    (await models.named.find({ orgId, migratedFrom: { $in: years.map((y) => `budgets:${y}`) } }, { migratedFrom: 1 }).lean().exec()).map((b) => b.migratedFrom),
  );
  let made = 0;
  for (const financialYear of years) {
    const migratedFrom = `budgets:${financialYear}`;
    if (done.has(migratedFrom)) continue;
    const rows = await models.legacy.find({ orgId, financialYear }).sort({ accountId: 1 }).lean().exec();
    const others = await models.named.find({ orgId, financialYear, status: { $ne: 'deleted' } }, { name: 1, isDefault: 1 }).lean().exec();
    const taken = new Set(others.map((b) => b.name.trim().toLowerCase()));
    const name = taken.has(`budget ${financialYear}`) ? `Budget ${financialYear} (earlier)` : `Budget ${financialYear}`;
    const isDefault = !others.some((b) => b.isDefault);
    try {
      const doc = await models.named.create({
        orgId, name, financialYear, period: 'monthly', includeBalanceSheet: false,
        rows: rows.map((r) => ({ accountId: r.accountId, monthsPaise: r.monthsPaise })),
        isDefault, status: 'active', migratedFrom,
        createdBy: rows[0]?.updatedBy ?? MIGRATION_ACTOR, updatedBy: MIGRATION_ACTOR,
      });
      await models.audit.record({
        orgId, entityType: 'Budget', entityId: String(doc._id), action: 'MIGRATE_BUDGET', performedBy: MIGRATION_ACTOR,
        before: { collection: 'budgets', financialYear, accounts: rows.length },
        after: { name, financialYear, period: 'monthly', isDefault, rows: rows.map((r) => ({ accountId: String(r.accountId), monthsPaise: r.monthsPaise })) },
      });
      made++;
    } catch (err) {
      // Another read copied it at the same moment; the next read sees it.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  return made;
}
