import { redirect } from 'next/navigation';

/** Purchases moved to a page per module: bills are where /purchase used to open. */
export default function PurchaseRedirect() {
  redirect('/purchases/bills');
}
