import { DocumentsShell } from '@/components/documents/documents-shell';

/** The Inbox is the Documents area's Files inbox: it sits beside the same panel. */
export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return <DocumentsShell>{children}</DocumentsShell>;
}
