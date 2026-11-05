import { redirect } from 'next/navigation';

/** Recurring invoices and payment reminders live under Sales now. */
export default function RecurringPage() {
  redirect('/sales/recurring-invoices');
}
