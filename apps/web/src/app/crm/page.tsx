import { redirect } from 'next/navigation';

/**
 * The CRM dashboard aggregates every other module, so it is built last
 * (Phase 8 of CA_CRM_BUILD_PLAN.md). Until then /crm lands on the one
 * view that holds real data rather than showing placeholder tiles.
 */
export default function CrmIndexPage() {
  redirect('/crm/clients');
}
