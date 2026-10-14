/**
 * Repairs journals reversed before reversals stopped mutating the original.
 *
 *   node apps/api/scripts/migrate-reversal-links.mjs [--apply]
 *
 * PostingService.reverse() used to flip the original journal to
 * status "reversed" and point the original's reversalOf at the contra entry.
 * Every report sums only "posted" journals, so after a reversal the books
 * counted the contra entry and not the original it cancels: reversing a
 * ₹10,000 sale left Sales at −₹10,000 instead of zero.
 *
 * reverse() now leaves the original posted and untouched (Invariant 3) and
 * sets reversalOf on the contra, pointing back at the original. For each
 * journal still marked "reversed" this script restores that shape, inside one
 * transaction per pair:
 *
 *   original:  status reversed → posted,  reversalOf removed
 *   contra:    reversalOf set to the original's id
 *
 * No amount, line, date or voucher number changes. These are raw driver
 * writes because the schema hooks refuse any update to a posted journal —
 * which is right for application code, and is why this is a one-off script.
 * Each repaired pair gets an audit log row.
 *
 * Dry run by default — pass --apply to write.
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

function readUriFromEnvFile() {
  for (const file of ['.env.local', '.env']) {
    try {
      const m = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').match(/^MONGODB_URI=(.+)$/m);
      if (m) return m[1].trim();
    } catch { /* try the next */ }
  }
  return null;
}
const MONGODB_URI =
  process.env.MONGODB_URI ?? readUriFromEnvFile() ?? 'mongodb://127.0.0.1:27019/ai_accounting?directConnection=true';

const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  const db = client.db();
  const journals = db.collection('journals');
  const auditLogs = db.collection('auditLogs');

  const originals = await journals.find({ status: 'reversed' }).toArray();

  if (originals.length === 0) {
    console.log('Nothing to migrate — no journal carries status=reversed.');
  } else {
    console.log(`${originals.length} reversed journal(s) found:\n`);
    const pairs = [];
    for (const o of originals) {
      const label = `${o.voucherType} #${o.voucherNumber} ${o.financialYear} (org ${o.orgId})`;
      const contra = o.reversalOf ? await journals.findOne({ _id: o.reversalOf }) : null;
      if (!contra) {
        console.log(`  SKIP ${label}: its reversal entry cannot be found — check by hand.`);
        continue;
      }
      if (contra.reversalOf && !contra.reversalOf.equals(o._id)) {
        console.log(`  SKIP ${label}: its reversal already points at a different journal — check by hand.`);
        continue;
      }
      console.log(`  ${label}  ← reversed by ${contra.voucherType} #${contra.voucherNumber} ${contra.financialYear}`);
      pairs.push({ o, contra });
    }

    if (!APPLY) {
      console.log(`\nDry run: ${pairs.length} pair(s) would be repaired. Re-run with --apply to write.`);
    } else {
      let repaired = 0;
      for (const { o, contra } of pairs) {
        const session = client.startSession();
        try {
          await session.withTransaction(async () => {
            await journals.updateOne(
              { _id: o._id, status: 'reversed' },
              { $set: { status: 'posted', updatedAt: new Date() }, $unset: { reversalOf: '' } },
              { session },
            );
            await journals.updateOne(
              { _id: contra._id },
              { $set: { reversalOf: o._id, updatedAt: new Date() } },
              { session },
            );
            await auditLogs.insertOne(
              {
                orgId: o.orgId,
                entityType: 'Journal',
                entityId: o._id.toString(),
                action: 'MIGRATE_REVERSAL_LINK',
                performedBy: 'system:migrate-reversal-links',
                meta: {
                  reversalJournalId: contra._id.toString(),
                  before: { status: 'reversed', reversalOf: contra._id.toString() },
                  after: { status: 'posted', contraReversalOf: o._id.toString() },
                },
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              { session },
            );
          });
          repaired++;
        } finally {
          await session.endSession();
        }
      }
      console.log(`\nRepaired ${repaired} pair(s). Reports now net each reversal to zero.`);
    }
  }
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
