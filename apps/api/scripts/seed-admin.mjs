/**
 * Creates a PLATFORM_SUPER_ADMIN user in development.
 * Run once: node apps/api/scripts/seed-admin.mjs
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcrypt';

// Read the same URI the API uses. Hard-coding a port sent this script to
// whichever mongod happened to own 27017 — on a machine with a stray local
// install that is not the app's database, and the admin silently landed
// somewhere the app never reads.
const MONGODB_URI =
  process.env.MONGODB_URI ?? readUriFromEnvFile() ?? 'mongodb://127.0.0.1:27018/ai_accounting?directConnection=true';

function readUriFromEnvFile() {
  for (const file of ['.env.local', '.env']) {
    const path = new URL(`../${file}`, import.meta.url);
    try {
      const match = readFileSync(path, 'utf8').match(/^MONGODB_URI=(.+)$/m);
      if (match) return match[1].trim();
    } catch {
      // Not every checkout has both files; try the next.
    }
  }
  return null;
}
const EMAIL    = 'admin@aibooks.in';
const PASSWORD = 'Admin@123';
const NAME     = 'Platform Admin';
const ORG_NAME = 'AiBooks Platform';

const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  const db = client.db();

  // ── 1. Check if admin already exists ─────────────────────────────
  const existing = await db.collection('users').findOne({ email: EMAIL });
  if (existing) {
    console.log(`Admin user already exists: ${EMAIL}`);
    console.log(`Password: ${PASSWORD}`);
    process.exit(0);
  }

  // ── 2. Create user ────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const userId = new ObjectId();
  await db.collection('users').insertOne({
    _id: userId,
    email: EMAIL,
    name: NAME,
    passwordHash,
    isActive: true,
    totpEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // ── 3. Create platform org ────────────────────────────────────────
  const orgId = new ObjectId();
  await db.collection('organizations').insertOne({
    _id: orgId,
    name: ORG_NAME,
    gstin: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // ── 4. Create PLATFORM_SUPER_ADMIN membership ─────────────────────
  await db.collection('orgMemberships').insertOne({
    _id: new ObjectId(),
    userId: userId,           // ObjectId — schema uses Types.ObjectId
    orgId: orgId.toString(),  // string — schema uses String
    role: 'PLATFORM_SUPER_ADMIN',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log('✓ Platform admin created successfully');
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`  Role:     PLATFORM_SUPER_ADMIN`);
  console.log('');
  console.log('Login at: http://localhost:3000/auth/login');
} finally {
  await client.close();
}
