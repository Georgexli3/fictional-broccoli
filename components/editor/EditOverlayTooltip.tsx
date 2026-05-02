"use client";

import { useEffect, useRef, useState } from "react";

import { currentText, originalText, type Block } from "@/lib/doc-model";

import { DiffView } from "./DiffView";

interface EditOverlayTooltipProps {
  block: Block;
}

/**
 * V1.5 stub: tooltip rendered when an overlay is hovered. S7 fleshes this
 * out with a fully-styled diff view.
 *
 * For S6 we render a minimal version so PdfEditOverlay's hover handler has
 * a real component to mount. S7 replaces the body without breaking the
 * import.
 */
export function EditOverlayTooltip({ block }: EditOverlayTooltipProps) {
  const before = originalText(block);
  const after = currentText(block);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  // Flip below if the tooltip would render off the top of the viewport.
  const [placement, setPlacement] = useState<"above" | "below">("above");

  useEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    // The tooltip is placed `bottom: 100%` (above the overlay) by default.
    // After mount, check whether it's clipped by the top of the viewport.
    const rect = el.getBoundingClientRect();
    if (rect.top < 80) {
      setPlacement("below");
    }
  }, []);

  return (
    <div
      ref={tooltipRef}
      role="tooltip"
      // pointer-events-none so the tooltip itself doesn't intercept the
      // overlay's hover state; user hovers the overlay below it.
      className={
        placement === "above"
          ? "pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-80 max-w-[320px] -translate-x-1/2 rounded-md border border-border bg-background p-3 text-xs shadow-lg"
          : "pointer-events-none absolute top-full left-1/2 z-50 mt-2 w-80 max-w-[320px] -translate-x-1/2 rounded-md border border-border bg-background p-3 text-xs shadow-lg"
      }
    >
      <div className="text-muted-foreground mb-1 text-[10px] font-medium uppercase tracking-wide">
        Edit · click to open
      </div>
      <div className="max-h-48 overflow-auto">
        <DiffView before={before} after={after} />
      </div>
    </div>
  );
}
