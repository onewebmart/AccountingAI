/**
 * Fills one existing organisation with realistic demo data, and creates one
 * login per role so the permission model can be seen rather than described.
 *
 *   node apps/api/scripts/seed-demo.mjs [owner-email]
 *
 * Defaults to kp@gmail.com. The org and firm must already exist — this script
 * populates an account, it does not create one.
 *
 * Business records are written through the running API, never straight into
 * Mongo, so every posting goes through PostingService: balanced double entry,
 * gapless voucher numbers, and an audit row for each change. The only direct
 * writes are user + membership documents, which carry no such invariants.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcrypt';

const OWNER_EMAIL = process.argv[2] ?? 'kp@gmail.com';
const API = process.env.API_URL ?? 'http://localhost:3001/api/v1';
const DEMO_PASSWORD = 'Demo@12345';

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

/** One login per role, so each permission set has a face. */
const ROLE_ACCOUNTS = [
  ['owner',      'COMPANY_ADMIN', 'Priya Nair',    'Runs the company books end to end.'],
  ['accountant', 'ACCOUNTANT',    'Ravi Kulkarni', 'Posts entries, approves AI proposals, files GST.'],
  ['reviewer',   'CA_REVIEWER',   'Anjali Desai',  'Reviews proposals but cannot post to the ledger.'],
  ['clerk',      'EMPLOYEE',      'Imran Shaikh',  'Uploads bills only — no ledger access.'],
  ['auditor',    'AUDITOR',       'Meera Iyer',    'Read-only across ledger, documents and audit trail.'],
  ['practice',   'FIRM_ADMIN',    'KP Practice',   'Runs the CA practice side (clients, deadlines, fees).'],
];

async function api(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
    throw new Error(`${method} ${path} → ${res.status}: ${msg ?? 'failed'}`);
  }
  return data;
}

async function login(email) {
  const res = await api('POST', '/auth/login', null, { email, password: DEMO_PASSWORD });
  return res.tokens.accessToken;
}

/** 18% GST split as CGST+SGST, all integer paise (Invariant 1). */
function gst18(taxableValue) {
  const half = Math.round(taxableValue * 0.09);
  return { taxableValue, cgst: half, sgst: half, igst: 0, cess: 0, total: taxableValue + half * 2 };
}

const client = new MongoClient(MONGODB_URI);
const created = { users: [], skipped: [] };

try {
  await client.connect();
  const db = client.db();

  // ── Locate the target org and firm ──────────────────────────────────
  const owner = await db.collection('users').findOne({ email: OWNER_EMAIL });
  if (!owner) throw new Error(`No user ${OWNER_EMAIL}. Sign up first.`);
  const membership = await db.collection('orgMemberships').findOne({ userId: owner._id });
  if (!membership) throw new Error(`${OWNER_EMAIL} has no organisation membership.`);
  const orgId = membership.orgId;
  const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
  const firm = org?.firmId ? await db.collection('firms').findOne({ _id: org.firmId }) : null;

  console.log(`Target org : ${org.name}  (${orgId})`);
  console.log(`Firm       : ${firm ? firm.name : '(none — practice pages will stay empty)'}`);
  console.log(`Owner      : ${OWNER_EMAIL}  role=${membership.role}\n`);

  // ── 1. One login per role ───────────────────────────────────────────
  const slug = (org.name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'demo').slice(0, 10);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const emailFor = (kind) => `${slug}.${kind}@demo.test`;

  for (const [kind, role, name] of ROLE_ACCOUNTS) {
    const email = emailFor(kind);
    const existing = await db.collection('users').findOne({ email });
    if (existing) {
      // Keep the role in step even when the user is already there, so re-runs
      // repair a matrix someone has since edited.
      await db.collection('orgMemberships').updateOne(
        { userId: existing._id, orgId },
        { $set: { role, isActive: true, updatedAt: new Date() } },
        { upsert: true },
      );
      created.skipped.push(`${email} (${role})`);
      continue;
    }
    const userId = new ObjectId();
    await db.collection('users').insertOne({
      _id: userId, email, name, passwordHash,
      isActive: true, totpEnabled: false, createdAt: new Date(), updatedAt: new Date(),
    });
    await db.collection('orgMemberships').insertOne({
      _id: new ObjectId(), userId, orgId, role, isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    });
    created.users.push(`${email} (${role})`);
  }
  console.log(`Role logins: ${created.users.length} created, ${created.skipped.length} already present`);
  console.log(`Password   : ${DEMO_PASSWORD}\n`);

  // ── 2. Books — as the ACCOUNTANT, who may post ──────────────────────
  const acct = await login(emailFor('accountant'));
  console.log('Seeding books as the accountant…');

  const customers = [
    { name: 'Deccan Retail LLP', gstin: '27AAECD1234F1Z5', phone: '9822011001', email: 'ap@deccanretail.in' },
    { name: 'Nimbus Softworks Pvt Ltd', gstin: '29AABCN5678K1Z2', phone: '9845022002', email: 'billing@nimbus.dev' },
    { name: 'Kaveri Traders', gstin: '29AAKFK9012L1Z8', phone: '9880033003', email: 'accounts@kaveri.co.in' },
  ];
  const customerIds = [];
  for (const c of customers) {
    const made = await api('POST', '/sales/customers', acct, c);
    customerIds.push(made._id ?? made.id);
  }

  const vendors = [
    { name: 'Sterling Stationers', gstin: '27AAFCS3456M1Z9', phone: '9820044004' },
    { name: 'Bharat Logistics', gstin: '27AACCB7890N1Z3', phone: '9821055005' },
  ];
  const vendorIds = [];
  for (const v of vendors) {
    const made = await api('POST', '/purchase/vendors', acct, v);
    vendorIds.push(made._id ?? made.id);
  }

  // Sales invoices — a paid one, a posted-unpaid one, and a draft.
  const salesPlan = [
    { customer: 0, date: '2026-06-12', due: '2026-06-27', taxable: 12_50_000, desc: 'Annual maintenance — FY26-27', post: true,  pay: true },
    { customer: 1, date: '2026-07-08', due: '2026-07-23', taxable: 8_40_000,  desc: 'Custom integration work',      post: true,  pay: false },
    { customer: 2, date: '2026-08-14', due: '2026-08-29', taxable: 3_20_000,  desc: 'Consulting retainer — Aug',    post: false, pay: false },
  ];
  let salesPosted = 0;
  for (const s of salesPlan) {
    const amounts = gst18(s.taxable);
    const inv = await api('POST', '/sales/invoices', acct, {
      customerId: customerIds[s.customer], invoiceDate: s.date, dueDate: s.due, amountsPaise: amounts,
      lineItems: [{ description: s.desc, qty: 1, ratePaise: s.taxable, amountPaise: s.taxable, taxRatePct: 18 }],
    });
    const id = inv._id ?? inv.id;
    if (s.post) { await api('POST', `/sales/invoices/${id}/post`, acct); salesPosted++; }
    if (s.pay) await api('POST', `/sales/invoices/${id}/pay`, acct);
  }

  const billPlan = [
    { vendor: 0, date: '2026-06-20', due: '2026-07-05', taxable: 1_80_000, desc: 'Office stationery — Q1', post: true,  pay: true },
    { vendor: 1, date: '2026-07-30', due: '2026-08-14', taxable: 4_60_000, desc: 'Freight — July dispatches', post: true, pay: false },
  ];
  let billsPosted = 0;
  for (const b of billPlan) {
    const amounts = gst18(b.taxable);
    const bill = await api('POST', '/purchase/bills', acct, {
      vendorId: vendorIds[b.vendor], billDate: b.date, dueDate: b.due, amountsPaise: amounts,
      lineItems: [{ description: b.desc, qty: 1, ratePaise: b.taxable, amountPaise: b.taxable, taxRatePct: 18 }],
    });
    const id = bill._id ?? bill.id;
    if (b.post) { await api('POST', `/purchase/bills/${id}/post`, acct); billsPosted++; }
    if (b.pay) await api('POST', `/purchase/bills/${id}/pay`, acct);
  }
  console.log(`  ${customerIds.length} customers, ${vendorIds.length} vendors`);
  console.log(`  ${salesPlan.length} sales invoices (${salesPosted} posted), ${billPlan.length} bills (${billsPosted} posted)\n`);

  // ── 3. Practice — as the FIRM_ADMIN ────────────────────────────────
  if (!firm) {
    console.log('No firm on this org, so the practice side is skipped.');
  } else {
    const fa = await login(emailFor('practice'));
    console.log('Seeding the practice as the firm admin…');

    const clients = [
      { name: 'Deccan Retail LLP', gstin: '27AAECD1234F1Z5', pan: 'AAECD1234F', contactName: 'Sunil Rao',
        whatsappNumber: '919822011001', contactEmail: 'sunil@deccanretail.in', services: ['GST_FILING', 'TDS', 'BOOKKEEPING'] },
      { name: 'Nimbus Softworks Pvt Ltd', gstin: '29AABCN5678K1Z2', pan: 'AABCN5678K', contactName: 'Farah Qureshi',
        whatsappNumber: '919845022002', contactEmail: 'farah@nimbus.dev', services: ['GST_FILING', 'ITR', 'ROC_MCA'] },
      { name: 'Kaveri Traders', gstin: '29AAKFK9012L1Z8', pan: 'AAKFK9012L', contactName: 'Girish Kamath',
        whatsappNumber: '919880033003', contactEmail: 'girish@kaveri.co.in', services: ['GST_FILING'] },
      { name: 'Sanghvi Jewellers', pan: 'AASFS4567P', contactName: 'Rekha Sanghvi',
        whatsappNumber: '919833066006', services: ['ITR', 'AUDIT'] },
    ];
    const clientOrgIds = [];
    for (const c of clients) {
      const made = await api('POST', '/firm/clients', fa, c);
      clientOrgIds.push(made.orgId ?? made._id ?? made.id);
    }

    const cal = await api('POST', '/crm/compliance/generate', fa, {});
    console.log(`  ${clientOrgIds.length} clients, ${cal.created} statutory deadlines generated`);

    const leads = [
      { name: 'Orchid Hospitality', contactName: 'Vivek Menon', whatsappNumber: '919900077007',
        source: 'REFERRAL', services: ['GST_FILING', 'BOOKKEEPING'],
        enquiryNotes: 'Two hotels in Pune, 40 staff. Wants monthly GST plus payroll-linked bookkeeping. Current CA retiring.',
        estimatedValuePaise: 18_00_000 },
      { name: 'Zenith Fabrics', contactName: 'Alka Bhatt', whatsappNumber: '919900088008',
        source: 'WEBSITE', services: ['GST_FILING'],
        enquiryNotes: 'Single GSTIN, exports to UAE. Needs LUT filing and refund claims.',
        estimatedValuePaise: 7_50_000 },
      { name: 'Pixel Forge Studio', contactName: 'Dev Patel', whatsappNumber: '919900099009',
        source: 'WHATSAPP', services: ['ITR'],
        enquiryNotes: 'Freelance design studio, three partners. Only annual ITR for now.',
        estimatedValuePaise: 2_00_000 },
    ];
    let leadCount = 0;
    for (const l of leads) {
      const made = await api('POST', '/crm/leads', fa, l);
      leadCount++;
      if (leadCount === 1) await api('POST', `/crm/leads/${made._id}/stage`, fa, { stage: 'QUALIFYING', note: 'Call booked for Friday' });
    }

    // Practice fees — one issued and part-paid, one still draft.
    const feePlan = [
      { client: 0, issue: '2026-07-01', due: '2026-07-16', lines: [
        { description: 'GST filing retainer — Q1 FY26-27', service: 'GST_FILING', amountPaise: 4_50_000 },
        { description: 'TDS returns — Q1', service: 'TDS', amountPaise: 1_50_000 }], issueIt: true, payPaise: 3_00_000 },
      { client: 1, issue: '2026-08-01', due: '2026-08-16', lines: [
        { description: 'ROC annual filing', service: 'ROC_MCA', amountPaise: 6_00_000 }], issueIt: true, payPaise: 0 },
      { client: 2, issue: '2026-08-20', due: '2026-09-04', lines: [
        { description: 'GST filing — Aug 2026', service: 'GST_FILING', amountPaise: 1_20_000 }], issueIt: false, payPaise: 0 },
    ];
    for (const f of feePlan) {
      const inv = await api('POST', '/crm/invoices', fa, {
        clientOrgId: clientOrgIds[f.client], issueDate: f.issue, dueDate: f.due, lines: f.lines,
      });
      if (f.issueIt) await api('POST', `/crm/invoices/${inv._id}/issue`, fa, {});
      if (f.payPaise > 0) await api('POST', `/crm/invoices/${inv._id}/payments`, fa,
        { amountPaise: f.payPaise, receivedOn: '2026-07-20' });
    }

    for (const t of [
      { title: 'Collect Aug purchase register from Deccan', clientOrgId: clientOrgIds[0], dueDate: '2026-08-28' },
      { title: 'Reconcile GSTR-2B mismatch — Nimbus', clientOrgId: clientOrgIds[1], dueDate: '2026-09-02' },
      { title: 'Draft engagement letter for Orchid Hospitality', dueDate: '2026-08-30' },
    ]) {
      await api('POST', '/crm/tasks', fa, t);
    }

    await api('POST', '/crm/document-requests', fa, {
      clientOrgId: clientOrgIds[0], service: 'GST_FILING', dueDate: '2026-09-05', purpose: 'Aug 2026 GST filing',
    });

    // A live client question, so the support agent has a real thread.
    await api('POST', '/crm/agent/inbound', fa, {
      channel: 'WHATSAPP', from: '919822011001', contactName: 'Sunil Rao',
      text: 'Bhai, August ki GST filing ka status kya hai? Aur kitna pay karna hai?',
    });

    console.log(`  ${leads.length} leads, ${feePlan.length} fee invoices, 3 tasks, 1 document request, 1 client conversation\n`);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('─'.repeat(64));
  console.log('Sign in with any of these — password is the same for all:\n');
  for (const [kind, role, name, what] of ROLE_ACCOUNTS) {
    console.log(`  ${emailFor(kind).padEnd(30)} ${role.padEnd(15)} ${what}`);
  }
  console.log(`\n  password: ${DEMO_PASSWORD}`);
  console.log(`\n  ${OWNER_EMAIL} keeps its own password and its ${membership.role} role.`);
} catch (e) {
  console.error('\nSeed failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
