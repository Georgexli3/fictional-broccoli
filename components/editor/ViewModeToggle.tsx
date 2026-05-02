"use client";

import { useSessionStore, usePdfViewMode } from "@/lib/session-store";
import { cn } from "@/lib/utils";

/**
 * V1.5: Original / Edited toggle for the PDF pane.
 *
 * Disabled when there are no accepted edits — there's nothing to overlay,
 * and the derived `usePdfViewMode` hook coerces back to `"original"`
 * regardless of stored value in that state.
 */
export function ViewModeToggle() {
  const setMode = useSessionStore((s) => s.setPdfViewMode);
  const editCount = useSessionStore((s) => s.doc?.history.length ?? 0);
  const mode = usePdfViewMode();
  const disabled = editCount === 0;

  return (
    <div
      role="group"
      aria-label="PDF view mode"
      title={
        disabled
          ? "Make an edit to see the Edited view."
          : `${editCount} edit${editCount === 1 ? "" : "s"} accepted`
      }
      className={cn(
        "border-border bg-muted/40 inline-flex h-7 items-center rounded-full border p-0.5 text-xs",
        disabled && "opacity-50",
      )}
    >
      <ToggleButton
        active={mode === "original"}
        disabled={false}
        onClick={() => setMode("original")}
      >
        Original
      </ToggleButton>
      <ToggleButton
        active={mode === "edited"}
        disabled={disabled}
        onClick={() => setMode("edited")}
      >
        Edited
        {editCount > 0 && (
          <span
            className={cn(
              "ml-1 rounded-full px-1 text-[10px] font-medium",
              mode === "edited"
                ? "bg-white/30 text-accent-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {editCount}
          </span>
        )}
      </ToggleButton>
    </div>
  );
}

interface ToggleButtonProps {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToggleButton({
  active,
  disabled,
  onClick,
  children,
}: ToggleButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center rounded-full px-3 transition",
        active
          ? "bg-accent text-accent-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}
