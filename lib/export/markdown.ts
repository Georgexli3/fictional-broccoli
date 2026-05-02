/**
 * Markdown exporter — walks the doc model and emits a clean, paste-ready
 * markdown string.
 *
 * Locked blocks (header_footer, figure) are excluded — we never had a
 * faithful representation of them, and emitting decorative junk would lie.
 */

import { currentText, type DocumentModel } from "../doc-model";

export function exportMarkdown(doc: DocumentModel, title: string): string {
  const lines: string[] = [];
  if (title) {
    lines.push(`# ${title}`);
    lines.push("");
  }

  let prevWasListItem = false;

  for (const block of doc.blocks) {
    const text = currentText(block).trim();
    if (!text) continue;

    switch (block.kind) {
      case "cover":
        // Cover content goes at the top under the title.
        lines.push(`> ${text.replace(/\n/g, "\n> ")}`);
        lines.push("");
        prevWasListItem = false;
        break;

      case "heading":
        if (prevWasListItem) lines.push("");
        lines.push(`## ${text}`);
        lines.push("");
        prevWasListItem = false;
        break;

      case "paragraph":
        lines.push(text);
        lines.push("");
        prevWasListItem = false;
        break;

      case "list_item":
        lines.push(`- ${text}`);
        prevWasListItem = true;
        break;

      case "caption":
        lines.push(`*${text}*`);
        lines.push("");
        prevWasListItem = false;
        break;

      case "table":
        lines.push("```");
        lines.push(text);
        lines.push("```");
        lines.push("");
        prevWasListItem = false;
        break;

      // figure + header_footer skipped intentionally.
      default:
        break;
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
