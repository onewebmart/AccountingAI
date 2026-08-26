/**
 * Splits practice administration out of the org role.
 *
 *   node apps/api/scripts/migrate-firm-role.mjs [--apply]
 *
 * `role` on a membership answers "what may you do to this org's books".
 * Practice administration is a different question on a different axis, and it
 * now lives in `firmRole`. Until this runs, anyone who switched on practice
 * management is stuck: their org role was overwritten with FIRM_ADMIN, which
 * holds no POST_JOURNAL, APPROVE_PROPOSAL, MANAGE_COA, MANAGE_SALES,
 * MANAGE_PURCHASE or UPLOAD_DOCUMENT — so they administer a firm whose books
 * they cannot touch.
 *
 * For each membership with role === FIRM_ADMIN this sets firmRole = FIRM_ADMIN
 * and restores role = COMPANY_ADMIN. That restoration is safe because no path
 * other than practice setup ever writes a FIRM_ADMIN membership, and practice
 * setup is only reachable by someone who already administered the org.
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
  process.env.MONGODB_URI ?? readUriFromEnvFile() ?? 'mongodb://127.0.0.1:27018/ai_accounting?directConnection=true';

const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  const db = client.db();
  const memberships = db.collection('orgMemberships');

  const affected = await memberships.find({ role: 'FIRM_ADMIN' }).toArray();

  if (affected.length === 0) {
    console.log('Nothing to migrate — no membership carries role=FIRM_ADMIN.');
  } else {
    console.log(`${affected.length} membership(s) to migrate:\n`);
    for (const m of affected) {
      const user = await db.collection('users').findOne({ _id: m.userId });
      const org = await db.collection('organizations').findOne({ _id: new (await import('mongodb')).ObjectId(m.orgId) });
      console.log(`  ${(user?.email ?? m.userId).padEnd(32)} org=${org?.name ?? m.orgId}`);
      console.log(`    role FIRM_ADMIN → COMPANY_ADMIN,  firmRole → FIRM_ADMIN`);
    }

    if (APPLY) {
      const res = await memberships.updateMany(
        { role: 'FIRM_ADMIN' },
        { $set: { role: 'COMPANY_ADMIN', firmRole: 'FIRM_ADMIN', updatedAt: new Date() } },
      );
      console.log(`\nApplied to ${res.modifiedCount} membership(s).`);
      console.log('Affected users must sign in again — role and firmRole are token claims.');
    } else {
      console.log('\nDry run. Re-run with --apply to write.');
    }
  }
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
