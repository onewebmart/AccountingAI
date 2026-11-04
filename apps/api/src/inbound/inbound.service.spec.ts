/**
 * Integration tests — bills sent in by email and WhatsApp.
 *
 *  ✓ Each org has its own address; replacing it stops the old one at once
 *  ✓ An email's bill is filed to the org that owns the address, once, with where it came from
 *  ✓ A logo is skipped, an unreadable file refused, each with the reason; another org sees none of it
 *  ✓ A sender who is neither a vendor nor a member is flagged
 *  ✓ A WhatsApp number is linked only from the phone, by a single-use code that expires
 *  ✓ Its bills are then filed once, to the one business it is linked to; linking elsewhere moves it
 */
import 'reflect-metadata';
import mongoose, { Model, Types } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { DocumentStatus, UserRole } from '@ai-accounting/shared';
import configuration from '../config/configuration';
import { testMongoUri } from '../test-utils/mongo';
import { InboundService } from './inbound.service';
import { InboundMessage, InboundMessageSchema } from './schemas/inbound-message.schema';
import { WHATSAPP_MEDIA } from './whatsapp-media';
import { InboundEmail } from './email-payload';
import { DocumentsService, DOCUMENT_PROCESSING_QUEUE } from '../documents/documents.service';
import { StorageService } from '../documents/storage.service';
import { Document, DocumentSchema } from '../documents/schemas/document.schema';
import { OcrResult, OcrResultSchema } from '../ocr/schemas/ocr-result.schema';
import { ProposedEntry, ProposedEntrySchema } from '../proposals/schemas/proposed-entry.schema';
import { AuditService } from '../gl/audit.service';
import { AuditLog, AuditLogSchema } from '../gl/schemas/audit-log.schema';
import { OrgSettings, OrgSettingsSchema } from '../org-settings/schemas/org-settings.schema';
import { Vendor, VendorSchema } from '../purchase/schemas/vendor.schema';
import { OrgMembership, OrgMembershipSchema } from '../tenancy/schemas/org-membership.schema';
import { User, UserSchema } from '../tenancy/schemas/user.schema';
import { withOrg } from '../database/tenant.plugin';

const DOMAIN = 'in.example.com';
const ACTOR = new Types.ObjectId().toString();
const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
const storage = { upload: jest.fn(async () => undefined), exists: jest.fn(async () => false), presignedUrl: jest.fn(async (k: string) => k) };
const media = { configured: true, fetch: jest.fn(async (id: string) => ({ buffer: Buffer.from(`%PDF-1.4 ${id}`), mimeType: 'application/pdf' })) };

let moduleRef: TestingModule;
let inbound: InboundService;
let messages: Model<InboundMessage>;
let documents: Model<Document>;
let vendors: Model<Vendor>;
let users: Model<User>;
let memberships: Model<OrgMembership>;
let audit: Model<{ orgId: string; action: string; entityType: string }>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          configuration,
          () => ({ inbound: { emailDomain: DOMAIN, emailSecret: 'mail-secret', whatsappVerifyToken: 'verify', whatsappAppSecret: 'app-secret', whatsappAccessToken: 'token', whatsappGraphVersion: 'v21.0' } }),
        ],
      }),
      MongooseModule.forRoot(testMongoUri()),
      MongooseModule.forFeature([
        { name: InboundMessage.name, schema: InboundMessageSchema },
        { name: OrgSettings.name, schema: OrgSettingsSchema },
        { name: Vendor.name, schema: VendorSchema },
        { name: OrgMembership.name, schema: OrgMembershipSchema },
        { name: User.name, schema: UserSchema },
        { name: Document.name, schema: DocumentSchema },
        { name: OcrResult.name, schema: OcrResultSchema },
        { name: ProposedEntry.name, schema: ProposedEntrySchema },
        { name: AuditLog.name, schema: AuditLogSchema },
      ]),
    ],
    providers: [
      InboundService,
      DocumentsService,
      AuditService,
      { provide: StorageService, useValue: storage },
      { provide: getQueueToken(DOCUMENT_PROCESSING_QUEUE), useValue: queue },
      { provide: WHATSAPP_MEDIA, useValue: media },
    ],
  }).compile();
  inbound = moduleRef.get(InboundService);
  messages = moduleRef.get(getModelToken(InboundMessage.name));
  documents = moduleRef.get(getModelToken(Document.name));
  vendors = moduleRef.get(getModelToken(Vendor.name));
  users = moduleRef.get(getModelToken(User.name));
  memberships = moduleRef.get(getModelToken(OrgMembership.name));
  audit = moduleRef.get(getModelToken(AuditLog.name));
}, 60_000);

afterAll(async () => {
  await moduleRef.close();
  await mongoose.disconnect();
});

const org = () => new Types.ObjectId().toString();
const unique = () => new Types.ObjectId().toString();

function email(to: string, over: Partial<InboundEmail> = {}): InboundEmail {
  return {
    recipients: [to],
    from: 'accounts@raotraders.in',
    fromName: 'Rao Traders',
    subject: 'Invoice RT/118',
    messageId: unique(),
    attachments: [{ fileName: 'RT-118.pdf', mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 ${unique()}`), contentId: null }],
    ...over,
  };
}

describe('email-in', () => {
  it('gives each org its own address, and replacing it stops the old one', async () => {
    const a = org();
    const first = await inbound.emailAddress(a);
    expect(first.configured).toBe(true);
    expect(first.address).toMatch(new RegExp(`^bills-[a-z2-9]{10}@${DOMAIN.replace(/\./g, '\\.')}$`));
    expect((await inbound.emailAddress(a)).address).toBe(first.address);
    expect((await inbound.emailAddress(org())).address).not.toBe(first.address);

    const second = await inbound.rotate(a, ACTOR);
    expect(second.address).not.toBe(first.address);
    expect(await inbound.receiveEmail(email(first.address!))).toEqual({ accepted: 0, handled: false });
    expect(await inbound.receiveEmail(email(second.address!))).toMatchObject({ accepted: 1, handled: true });
    expect(await audit.countDocuments({ orgId: a, action: 'ROTATE_INBOX_ADDRESS' })).toBe(1);
  });

  it('files a bill to the org that owns the address, once, and says what became of each file', async () => {
    const a = org();
    const b = org();
    await vendors.create({ orgId: a, name: 'Rao Traders', email: 'Accounts@RaoTraders.in' });
    const { address } = await inbound.emailAddress(a);
    await inbound.emailAddress(b);

    const bill = Buffer.from(`%PDF-1.4 ${unique()}`);
    const sent = email(address!, {
      attachments: [
        { fileName: 'RT-118.pdf', mimeType: 'application/pdf', buffer: bill, contentId: null },
        { fileName: 'image001.png', mimeType: 'image/png', buffer: Buffer.alloc(3_000), contentId: 'logo@01' },
        { fileName: 'setup.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ'), contentId: null },
      ],
    });
    expect(await inbound.receiveEmail(sent)).toEqual({ accepted: 1, handled: true });

    const [message] = await withOrg(a, () => messages.find({ messageId: sent.messageId }).lean().exec());
    expect(message).toMatchObject({ channel: 'email', from: 'accounts@raotraders.in', knownSender: true });
    expect(message.files.map((f) => f.status)).toEqual(['accepted', 'skipped', 'rejected']);
    expect(message.files[2].reason).toBeTruthy();

    const doc = await documents.findById(message.files[0].documentId).lean().exec();
    expect(doc).toMatchObject({ orgId: a, status: DocumentStatus.UPLOADED, uploadedBy: null, source: { channel: 'email', from: 'accounts@raotraders.in', subject: 'Invoice RT/118' } });
    expect(queue.add).toHaveBeenCalled();

    // The provider delivers it again: nothing new.
    await inbound.receiveEmail(sent);
    expect(await documents.countDocuments({ orgId: a, sha256: doc!.sha256 })).toBe(1);
    expect(await messages.countDocuments({ orgId: a })).toBe(1);

    // The same bill in a new email is filed as a duplicate for a person to decide.
    await inbound.receiveEmail(email(address!, { attachments: [{ fileName: 'RT-118 again.pdf', mimeType: 'application/pdf', buffer: bill, contentId: null }] }));
    const statuses = (await withOrg(a, () => inbound.list(a))).flatMap((m) => m.files.map((f) => f.status));
    expect(statuses).toContain('duplicate');

    // The other org sees none of it, even asking without a filter.
    expect(await withOrg(b, () => messages.countDocuments({}).exec())).toBe(0);
    expect(await withOrg(b, () => documents.countDocuments({}).exec())).toBe(0);
    expect(await audit.countDocuments({ orgId: a, entityType: 'InboundMessage', action: 'RECEIVE' })).toBe(2);
  });

  it('ignores an address no org holds, and records an email with nothing attached', async () => {
    expect(await inbound.receiveEmail(email(`bills-zzzzzzzzzz@${DOMAIN}`))).toEqual({ accepted: 0, handled: false });
    expect(await inbound.receiveEmail(email('someone@elsewhere.in'))).toEqual({ accepted: 0, handled: false });

    const a = org();
    const { address } = await inbound.emailAddress(a);
    const sent = email(address!, { attachments: [] });
    await inbound.receiveEmail(sent);
    const [message] = await inbound.list(a);
    expect(message.files).toEqual([expect.objectContaining({ fileName: '(no attachment)', status: 'skipped' })]);
  });

  it('flags a sender who is neither a vendor nor a member', async () => {
    const a = org();
    const { address } = await inbound.emailAddress(a);
    const user = await users.create({ email: `meera.${unique()}@shop.in`, name: 'Meera' });
    await memberships.create({ orgId: a, userId: user._id, role: UserRole.COMPANY_ADMIN });

    await inbound.receiveEmail(email(address!, { from: 'stranger@spam.example' }));
    await inbound.receiveEmail(email(address!, { from: user.email }));
    const list = await inbound.list(a);
    const bySender = Object.fromEntries(list.map((m) => [m.from, m.knownSender]));
    expect(bySender).toEqual({ 'stranger@spam.example': false, [user.email]: true });
  });
});

describe('WhatsApp-in', () => {
  const doc = (from: string, id = `wamid.${unique()}`) => ({
    entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: 'Ravi' } }], messages: [{ id, from, type: 'document', document: { id: `media-${id}`, filename: 'Diesel.pdf', mime_type: 'application/pdf' } }] } }] }],
  });
  const text = (from: string, body: string) => ({ entry: [{ changes: [{ value: { messages: [{ id: `wamid.${unique()}`, from, type: 'text', text: { body } }] } }] }] });
  const phone = () => `919${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  const codeOf = (t: string) => t.replace(/^LINK /, '');

  it('links a number only from the phone, then files its bills, once', async () => {
    const a = org();
    const from = phone();
    // Not linked: nothing is filed.
    expect(await inbound.receiveWhatsapp(doc(from))).toEqual({ linked: 0, filed: 0, skipped: 1 });

    const { text: say, expiresAt } = await inbound.whatsappLinkCode(a, ACTOR);
    expect(say).toMatch(/^LINK [A-Z2-9]{6}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    // Sent in lower case with spaces around it, as people type.
    expect(await inbound.receiveWhatsapp(text(from, `  link ${codeOf(say).toLowerCase()} `))).toEqual({ linked: 1, filed: 0, skipped: 0 });
    expect((await inbound.whatsappSenders(a)).senders).toEqual([from]);

    const id = `wamid.${unique()}`;
    expect(await inbound.receiveWhatsapp(doc(from, id))).toEqual({ linked: 0, filed: 1, skipped: 0 });
    const [message] = await inbound.list(a);
    expect(message).toMatchObject({ channel: 'whatsapp', from, fromName: 'Ravi', knownSender: true });
    expect(message.files[0].status).toBe('accepted');

    // Meta redelivers: the file is not fetched or filed again.
    media.fetch.mockClear();
    await inbound.receiveWhatsapp(doc(from, id));
    expect(media.fetch).not.toHaveBeenCalled();
    expect(await messages.countDocuments({ orgId: a })).toBe(1);

    // The code was used up: another phone cannot link with it.
    const other = phone();
    expect(await inbound.receiveWhatsapp(text(other, say))).toEqual({ linked: 0, filed: 0, skipped: 0 });
    expect((await inbound.whatsappSenders(a)).senders).toEqual([from]);
    expect(await audit.countDocuments({ orgId: a, action: 'LINK_WHATSAPP_SENDER' })).toBe(1);
  });

  it('files a number to one business: linking it elsewhere moves it', async () => {
    const a = org();
    const b = org();
    const from = phone();
    await inbound.receiveWhatsapp(text(from, (await inbound.whatsappLinkCode(a, ACTOR)).text));
    await inbound.receiveWhatsapp(text(from, (await inbound.whatsappLinkCode(b, ACTOR)).text));
    expect((await inbound.whatsappSenders(a)).senders).toEqual([]);
    expect((await inbound.whatsappSenders(b)).senders).toEqual([from]);
    expect(await audit.countDocuments({ orgId: a, action: 'UNLINK_WHATSAPP_SENDER' })).toBe(1);

    expect(await inbound.receiveWhatsapp(doc(from))).toMatchObject({ filed: 1 });
    expect(await messages.countDocuments({ orgId: a })).toBe(0);
    expect(await messages.countDocuments({ orgId: b })).toBe(1);

    await inbound.unlinkWhatsappSender(b, ACTOR, `+${from}`);
    expect((await inbound.whatsappSenders(b)).senders).toEqual([]);
    expect(await inbound.receiveWhatsapp(doc(from))).toMatchObject({ filed: 0, skipped: 1 });
  });

  it('does not link with an expired or unknown code', async () => {
    const a = org();
    const { text: say } = await inbound.whatsappLinkCode(a, ACTOR);
    await moduleRef.get<Model<OrgSettings>>(getModelToken(OrgSettings.name)).updateOne({ orgId: a }, { $set: { whatsappLinkCodeExpiresAt: new Date(Date.now() - 1000) } });
    expect(await inbound.receiveWhatsapp(text(phone(), say))).toMatchObject({ linked: 0 });
    expect(await inbound.receiveWhatsapp(text(phone(), 'LINK zzzzzz'))).toMatchObject({ linked: 0 });
    expect(await inbound.receiveWhatsapp(text(phone(), 'please link me'))).toMatchObject({ linked: 0 });
    expect((await inbound.whatsappSenders(a)).senders).toEqual([]);
  });
});
