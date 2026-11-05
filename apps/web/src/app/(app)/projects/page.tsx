import { redirect } from 'next/navigation';

/** Moved: projects and their time are under Time Tracking. */
export default function ProjectsRedirect() {
  redirect('/time/projects');
}
