/**
 * Unit tests — what the mail provider and Meta send us, read.
 *
 *  ✓ A Postmark inbound email: every recipient, the sender, the attachments decoded
 *  ✓ A logo in a signature is told apart from a bill
 *  ✓ Meta's signature over the raw body: right secret only, tampered body refused
 *  ✓ A WhatsApp webhook: documents and photos, never text or status updates
 *  ✓ A "LINK <code>" text is recognised, and a near miss is not
 *  ✓ Indian mobile numbers, however written, to one form
 */
import { createHmac } from 'crypto';
import { looksLikeSignatureImage, parsePostmarkInbound } from './email-payload';
import { filesInWebhook, linkRequestsInWebhook, normalisePhone, verifyMetaSignature } from './whatsapp';

describe('Postmark inbound email', () => {
  it('reads recipients, sender and attachments', () => {
    const email = parsePostmarkInbound({
      From: 'Rao Traders <Accounts@RaoTraders.in>',
      FromFull: { Email: 'Accounts@RaoTraders.in', Name: ' Rao Traders ' },
      To: '"Bills" <bills-abc2345678@in.example.com>',
      ToFull: [{ Email: 'bills-abc2345678@in.example.com' }],
      Cc: 'owner@shop.in',
      OriginalRecipient: 'BILLS-abc2345678@in.example.com',
      Subject: '  Invoice RT/118  ',
      MessageID: 'm-1',
      Attachments: [
        { Name: 'RT-118.pdf', Content: Buffer.from('%PDF-1.4').toString('base64'), ContentType: 'application/pdf; name=RT-118.pdf' },
        { Name: '../../etc/passwd', Content: Buffer.from('x').toString('base64'), ContentType: 'text/plain' },
        { Name: 'empty.pdf', Content: '' },
      ],
    });
    expect(email.recipients).toEqual(['bills-abc2345678@in.example.com', 'owner@shop.in']);
    expect(email).toMatchObject({ from: 'accounts@raotraders.in', fromName: 'Rao Traders', subject: 'Invoice RT/118', messageId: 'm-1' });
    expect(email.attachments).toHaveLength(2);
    expect(email.attachments[0]).toMatchObject({ fileName: 'RT-118.pdf', mimeType: 'application/pdf' });
    expect(email.attachments[0].buffer.toString()).toBe('%PDF-1.4');
    // No path survives in a file name.
    expect(email.attachments[1].fileName).not.toContain('/');
  });

  it('takes a bare From when FromFull is missing, and copes with nothing at all', () => {
    expect(parsePostmarkInbound({ From: 'Someone <a.b@c.in>' }).from).toBe('a.b@c.in');
    expect(parsePostmarkInbound(null)).toMatchObject({ recipients: [], from: null, subject: null, messageId: null, attachments: [] });
  });

  it('tells a signature logo from a photo of a bill', () => {
    const small = Buffer.alloc(4_000);
    expect(looksLikeSignatureImage({ fileName: 'image001.png', mimeType: 'image/png', buffer: small, contentId: null })).toBe(true);
    expect(looksLikeSignatureImage({ fileName: 'logo.png', mimeType: 'image/png', buffer: small, contentId: 'cid:1' })).toBe(true);
    expect(looksLikeSignatureImage({ fileName: 'bill.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(300_000), contentId: 'cid:2' })).toBe(false);
    expect(looksLikeSignatureImage({ fileName: 'bill.pdf', mimeType: 'application/pdf', buffer: small, contentId: 'cid:3' })).toBe(false);
  });
});

describe('WhatsApp webhook', () => {
  const secret = 'app-secret';
  const body = Buffer.from('{"entry":[]}');
  const sign = (b: Buffer, s = secret) => `sha256=${createHmac('sha256', s).update(b).digest('hex')}`;

  it('trusts only a signature made with the app secret over these exact bytes', () => {
    expect(verifyMetaSignature(body, sign(body), secret)).toBe(true);
    expect(verifyMetaSignature(body, sign(body, 'other'), secret)).toBe(false);
    expect(verifyMetaSignature(Buffer.from('{"entry":[1]}'), sign(body), secret)).toBe(false);
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=abc', secret)).toBe(false);
    expect(verifyMetaSignature(body, sign(body, ''), '')).toBe(false);
  });

  it('finds documents and photos, and nothing else', () => {
    const files = filesInWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: '919876543210', profile: { name: 'Ravi' } }],
                messages: [
                  { id: 'wamid.AAA11111', from: '919876543210', type: 'document', document: { id: 'media-1', filename: 'Bill 42.pdf', mime_type: 'application/pdf', caption: ' Diesel ' } },
                  { id: 'wamid.BBB22222', from: '919876543210', type: 'image', image: { id: 'media-2', mime_type: 'image/jpeg' } },
                  { id: 'wamid.CCC33333', from: '919876543210', type: 'text' },
                  { id: 'wamid.DDD44444', from: '919876543210', type: 'image', image: {} },
                ],
              },
            },
            { value: { statuses: [{ id: 'wamid.AAA11111', status: 'read' }] } },
          ],
        },
      ],
    });
    expect(files).toEqual([
      { messageId: 'wamid.AAA11111', from: '919876543210', fromName: 'Ravi', mediaId: 'media-1', fileName: 'Bill 42.pdf', mimeType: 'application/pdf', caption: 'Diesel' },
      { messageId: 'wamid.BBB22222', from: '919876543210', fromName: 'Ravi', mediaId: 'media-2', fileName: 'whatsapp-BBB22222.jpg', mimeType: 'image/jpeg', caption: null },
    ]);
    expect(filesInWebhook(undefined)).toEqual([]);
  });

  it('reads "LINK <code>" texts, and nothing else', () => {
    const msg = (body: string, type = 'text') => ({ id: `wamid.${body.length}${type}`, from: '+919876543210', type, text: { body } });
    const found = linkRequestsInWebhook({
      entry: [{ changes: [{ value: { messages: [msg('LINK AB2C3D'), msg(' link ab2c3d '), msg('LINK ab2c3'), msg('LINK ab2c3d please'), msg('LINK AB2C3D', 'image')] } }] }],
    });
    expect(found.map((f) => f.code)).toEqual(['ab2c3d', 'ab2c3d']);
    expect(found[0].from).toBe('919876543210');
  });

  it('writes a number one way, whichever way it was typed', () => {
    for (const typed of ['+91 98765 43210', '098765 43210', '9876543210', '91-98765-43210']) expect(normalisePhone(typed)).toBe('919876543210');
    expect(normalisePhone('+44 7700 900123')).toBe('447700900123');
    expect(normalisePhone('12345')).toBeNull();
  });
});
