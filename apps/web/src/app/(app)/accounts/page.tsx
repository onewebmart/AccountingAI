import { redirect } from 'next/navigation';

/** Moved: the chart of accounts is under Accountant now. */
export default function AccountsRedirect() {
  redirect('/accountant/chart-of-accounts');
}
