import { redirect } from 'next/navigation';

/** Purchases opens on its bills. */
export default function PurchasesIndex() {
  redirect('/purchases/bills');
}
