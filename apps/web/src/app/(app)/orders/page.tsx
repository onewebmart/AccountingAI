import { redirect } from 'next/navigation';

/** Quotes, sales orders and challans each have their own page under Sales now. */
export default function OrdersPage() {
  redirect('/sales/quotes');
}
