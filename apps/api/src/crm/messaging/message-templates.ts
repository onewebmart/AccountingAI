import { MessageChannel, MessageTemplateKey } from '@ai-accounting/shared';

export interface MessageTemplate {
  key: MessageTemplateKey;
  /** Shown in the settings UI. English — this is CA-facing chrome. */
  label: string;
  description: string;
  /** Email subject line. Omitted for WhatsApp-only templates. */
  subject?: string;
  /** Body with {{variable}} placeholders. Hinglish — this is client-facing. */
  body: string;
  /** Variables the caller must supply. Rendering fails loudly if any is missing. */
  variables: string[];
  channels: MessageChannel[];
}

/**
 * Client-facing copy is Hinglish by decision D1 in CA_CRM_BUILD_PLAN.md: the CA
 * staff read the app chrome in English, but the client reading a WhatsApp
 * reminder is an Indian SME owner. App labels here stay English.
 *
 * These are the built-in defaults. Phase 9 makes them editable per firm; until
 * then they are the single source of outbound copy.
 */
export const MESSAGE_TEMPLATES: Record<MessageTemplateKey, MessageTemplate> = {
  [MessageTemplateKey.DOCUMENT_REMINDER]: {
    key: MessageTemplateKey.DOCUMENT_REMINDER,
    label: 'Document reminder',
    description: 'Sent when a client still owes documents for a filing.',
    subject: '{{firmName}} — {{purpose}} ke liye documents pending',
    body:
      'Namaste {{clientName}} ji,\n\n' +
      '{{purpose}} ke liye ye documents abhi pending hain:\n' +
      '{{documentList}}\n\n' +
      'Last date {{dueDate}} hai. Kripya jald se jald bhej dein taaki hum time par file kar sakein.\n\n' +
      'Dhanyavaad,\n{{firmName}}',
    variables: ['clientName', 'purpose', 'documentList', 'dueDate', 'firmName'],
    channels: [MessageChannel.WHATSAPP, MessageChannel.EMAIL],
  },

  [MessageTemplateKey.COMPLIANCE_DEADLINE]: {
    key: MessageTemplateKey.COMPLIANCE_DEADLINE,
    label: 'Compliance deadline',
    description: 'Statutory due-date reminder, sent 7 / 3 / 1 days before.',
    subject: '{{firmName}} — {{complianceName}} due {{dueDate}}',
    body:
      'Namaste {{clientName}} ji,\n\n' +
      '{{complianceName}} ki last date {{dueDate}} hai — sirf {{daysLeft}} din baaki hain.\n\n' +
      'Agar aapka data ready hai to hum file kar denge. Koi document pending ho to bata dijiye.\n\n' +
      'Dhanyavaad,\n{{firmName}}',
    variables: ['clientName', 'complianceName', 'dueDate', 'daysLeft', 'firmName'],
    channels: [MessageChannel.WHATSAPP, MessageChannel.EMAIL],
  },

  [MessageTemplateKey.INVOICE_DUE]: {
    key: MessageTemplateKey.INVOICE_DUE,
    label: 'Invoice due soon',
    description: 'Polite reminder before the due date passes.',
    subject: '{{firmName}} — Invoice {{invoiceNumber}} due {{dueDate}}',
    body:
      'Namaste {{clientName}} ji,\n\n' +
      'Aapka invoice {{invoiceNumber}} ({{serviceSummary}}) ka amount {{amount}} hai, ' +
      'jiski due date {{dueDate}} hai.\n\n' +
      'Payment ho chuka ho to is message ko ignore kijiye.\n\n' +
      'Dhanyavaad,\n{{firmName}}',
    variables: [
      'clientName',
      'invoiceNumber',
      'serviceSummary',
      'amount',
      'dueDate',
      'firmName',
    ],
    channels: [MessageChannel.WHATSAPP, MessageChannel.EMAIL],
  },

  [MessageTemplateKey.INVOICE_OVERDUE]: {
    key: MessageTemplateKey.INVOICE_OVERDUE,
    label: 'Invoice overdue',
    description: 'Firmer follow-up once an invoice is past due.',
    subject: '{{firmName}} — Invoice {{invoiceNumber}} overdue ({{daysOverdue}} days)',
    body:
      'Namaste {{clientName}} ji,\n\n' +
      'Invoice {{invoiceNumber}} ka amount {{amount}} abhi tak pending hai — ' +
      'due date se {{daysOverdue}} din ho gaye hain.\n\n' +
      'Kripya payment jald karein, ya koi issue ho to humein batayein.\n\n' +
      'Dhanyavaad,\n{{firmName}}',
    variables: ['clientName', 'invoiceNumber', 'amount', 'daysOverdue', 'firmName'],
    channels: [MessageChannel.WHATSAPP, MessageChannel.EMAIL],
  },

  [MessageTemplateKey.LEAD_FOLLOW_UP]: {
    key: MessageTemplateKey.LEAD_FOLLOW_UP,
    label: 'Lead follow-up',
    description: 'Nudge on a proposal that has had no response.',
    subject: '{{firmName}} — {{serviceSummary}} ke baare mein',
    body:
      'Namaste {{leadName}} ji,\n\n' +
      'Humne aapko {{serviceSummary}} ke liye proposal bheja tha. ' +
      'Koi sawaal ho to bata dijiye, main clear kar dunga.\n\n' +
      'Dhanyavaad,\n{{firmName}}',
    variables: ['leadName', 'serviceSummary', 'firmName'],
    channels: [MessageChannel.WHATSAPP, MessageChannel.EMAIL],
  },

  [MessageTemplateKey.GENERIC]: {
    key: MessageTemplateKey.GENERIC,
    label: 'Free-form message',
    description: 'Ad-hoc message typed by a team member. No substitution.',
    body: '{{body}}',
    variables: ['body'],
    channels: [MessageChannel.WHATSAPP, MessageChannel.EMAIL],
  },
};

export class TemplateRenderError extends Error {}

/**
 * Substitutes {{variable}} placeholders.
 *
 * Missing variables throw rather than rendering "{{dueDate}}" to a client — a
 * half-rendered reminder is worse than a failed job, because the failure is
 * visible in the outbox and the bad message would not be.
 */
export function renderTemplate(
  key: MessageTemplateKey,
  channel: MessageChannel,
  variables: Record<string, string>,
): { body: string; subject?: string } {
  const template = MESSAGE_TEMPLATES[key];
  if (!template) throw new TemplateRenderError(`Unknown template "${key}"`);

  if (!template.channels.includes(channel)) {
    throw new TemplateRenderError(`Template "${key}" does not support channel ${channel}`);
  }

  const missing = template.variables.filter((v) => {
    const value = variables[v];
    return value === undefined || value === null || value === '';
  });
  if (missing.length) {
    throw new TemplateRenderError(
      `Template "${key}" is missing variable(s): ${missing.join(', ')}`,
    );
  }

  const substitute = (text: string): string =>
    text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => variables[name] ?? '');

  return {
    body: substitute(template.body),
    // WhatsApp has no subject; only carry one when the channel uses it.
    subject:
      channel === MessageChannel.EMAIL && template.subject
        ? substitute(template.subject)
        : undefined,
  };
}
