import { effectiveMimeType } from './ocr-cascade.service';

/**
 * Uploads regularly arrive with a useless content type — `multipart/form-data`
 * parts carry whatever the client chose to send, and "application/octet-stream"
 * is common. The upload controller already accepts those on the strength of the
 * file extension; the cascade has to route on the same understanding.
 *
 * The bug this guards: a PDF uploaded as octet-stream skipped the PDF branch,
 * fell through to the image tier, and was posted to the vision model tagged
 * `image/jpeg`. Gemini answered "Unable to process input image" and the
 * document failed outright, despite having a perfectly readable text layer.
 */
describe('effectiveMimeType', () => {
  it('keeps a specific type the client actually provided', () => {
    expect(effectiveMimeType('application/pdf', 'invoice.pdf')).toBe('application/pdf');
    expect(effectiveMimeType('image/png', 'scan.png')).toBe('image/png');
  });

  it('resolves a generic type from the file extension', () => {
    expect(effectiveMimeType('application/octet-stream', 'invoice.pdf')).toBe('application/pdf');
    expect(effectiveMimeType('application/octet-stream', 'scan.PNG')).toBe('image/png');
    expect(effectiveMimeType('binary/octet-stream', 'photo.jpeg')).toBe('image/jpeg');
    expect(effectiveMimeType('', 'bill.pdf')).toBe('application/pdf');
  });

  it('trusts the declared type over the extension when both are specific', () => {
    // A .txt holding a PDF is a mislabelled file, not a routing decision the
    // cascade should second-guess — Tier 0 handles text by extension already.
    expect(effectiveMimeType('image/png', 'invoice.pdf')).toBe('image/png');
  });

  it('leaves an unrecognised extension alone rather than guessing', () => {
    expect(effectiveMimeType('application/octet-stream', 'archive.zip')).toBe('application/octet-stream');
    expect(effectiveMimeType('application/octet-stream', 'noextension')).toBe('application/octet-stream');
  });
});
