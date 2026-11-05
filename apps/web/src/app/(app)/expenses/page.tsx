import { redirect } from 'next/navigation';

/** Employees' expense claims now live under Purchases. */
export default function ExpensesRedirect() {
  redirect('/purchases/claims');
}
