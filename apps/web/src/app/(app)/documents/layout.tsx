import { DocumentsShell } from '@/components/documents/documents-shell';

/** All Documents, Bank Statements and folders share the Documents panel; the Files inbox (/inbox) does too. */
export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return <DocumentsShell>{children}</DocumentsShell>;
}
