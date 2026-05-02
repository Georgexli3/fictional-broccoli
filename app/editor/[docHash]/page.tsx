/**
 * Editor page — 2-pane editor shell.
 *
 * V1 placeholder. M3 mounts PdfPane on the left; M4 mounts DocPane on the
 * right; M5 wires the edit loop; M7 adds ChangesSidebar; M8 adds hover-link.
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
