import { redirect } from 'next/navigation';

/** Time Tracking has no page of its own: its first module. */
export default function TimeIndex() {
  redirect('/time/projects');
}
