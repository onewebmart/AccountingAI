import { redirect } from 'next/navigation';

/** Sales has a page per module now; the old tabbed page goes to Invoices. */
export default function SalesPage() {
  redirect('/sales/invoices');
}
