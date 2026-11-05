import { redirect } from 'next/navigation';

/** Moved: locking and year-end close are Transaction Locking, under Accountant. */
export default function ClosingRedirect() {
  redirect('/accountant/transaction-locking');
}
