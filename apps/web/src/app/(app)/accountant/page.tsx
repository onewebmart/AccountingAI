import { redirect } from 'next/navigation';

/** Accountant has no page of its own: its first module. */
export default function AccountantIndex() {
  redirect('/accountant/manual-journals');
}
