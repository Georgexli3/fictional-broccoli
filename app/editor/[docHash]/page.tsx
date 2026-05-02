/**
 * Editor page — 2-pane editor shell (PDF | DocPane). Change history lives in
 * a collapsible drawer overlaid on the DocPane.
 */

import { notFound } from "next/navigation";

import { EditorBoot } from "@/components/editor/EditorBoot";

interface PageProps {
  params: Promise<{ docHash: string }>;
}

export default async function EditorPage({ params }: PageProps) {
  const { docHash } = await params;
  if (!/^[a-f0-9]{64}$/.test(docHash)) {
    notFound();
  }

  return <EditorBoot docHash={docHash} />;
}
