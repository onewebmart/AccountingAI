/**
 * Template rendering — Phase 2 acceptance criteria.
 *
 * The rule that matters: a template with a missing variable must FAIL, never
 * render "{{dueDate}}" into a message a client reads. A failed job is visible
 * in the outbox; a half-rendered reminder that went out is not.
 */
import 'reflect-metadata';
import { MessageChannel, MessageTemplateKey } from '@ai-accounting/shared';
import {
  MESSAGE_TEMPLATES,
  TemplateRenderError,
  renderTemplate,
} from './message-templates';

describe('renderTemplate', () => {
  const documentVars = {
    clientName: 'Ramesh',
    purpose: 'ITR Filing',
    documentList: '- Form 16\n- Bank Statement',
    dueDate: '31 Aug 2026',
    firmName: 'Sharma & Associates',
  };

  it('substitutes every placeholder', () => {
    const { body } = renderTemplate(
      MessageTemplateKey.DOCUMENT_REMINDER,
      MessageChannel.WHATSAPP,
      documentVars,
    );

    expect(body).toContain('Ramesh');
    expect(body).toContain('ITR Filing');
    expect(body).toContain('31 Aug 2026');
    expect(body).toContain('Sharma & Associates');
    expect(body).not.toMatch(/\{\{|\}\}/);
  });

  it('throws when a variable is missing rather than emitting a raw placeholder', () => {
    const incomplete = { ...documentVars };
    delete (incomplete as Partial<typeof documentVars>).dueDate;

    expect(() =>
      renderTemplate(MessageTemplateKey.DOCUMENT_REMINDER, MessageChannel.WHATSAPP, incomplete),
    ).toThrow(TemplateRenderError);
  });

  it('treats an empty string as missing — a blank due date helps nobody', () => {
    expect(() =>
      renderTemplate(MessageTemplateKey.DOCUMENT_REMINDER, MessageChannel.WHATSAPP, {
        ...documentVars,
        dueDate: '',
      }),
    ).toThrow(TemplateRenderError);
  });

  it('carries a subject for email but not for WhatsApp', () => {
    const email = renderTemplate(
      MessageTemplateKey.DOCUMENT_REMINDER,
      MessageChannel.EMAIL,
      documentVars,
    );
    const whatsapp = renderTemplate(
      MessageTemplateKey.DOCUMENT_REMINDER,
      MessageChannel.WHATSAPP,
      documentVars,
    );

    expect(email.subject).toContain('ITR Filing');
    expect(whatsapp.subject).toBeUndefined();
  });

  it('rejects an unknown template key', () => {
    expect(() =>
      renderTemplate('NOPE' as MessageTemplateKey, MessageChannel.EMAIL, {}),
    ).toThrow(TemplateRenderError);
  });

  it('every catalogue template declares exactly the variables its body uses', () => {
    for (const template of Object.values(MESSAGE_TEMPLATES)) {
      const used = new Set<string>();
      const sources = [template.body, template.subject ?? ''];
      for (const source of sources) {
        for (const match of source.matchAll(/\{\{(\w+)\}\}/g)) used.add(match[1]);
      }

      // Declared-but-unused would mean a needlessly rejected send;
      // used-but-undeclared would let a placeholder leak to a client.
      expect(new Set(template.variables)).toEqual(used);
    }
  });
});
