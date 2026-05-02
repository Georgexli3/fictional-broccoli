"use client";

import { useMemo } from "react";

import { computeDiff, type DiffOp } from "@/lib/diff";
import { cn } from "@/lib/utils";

interface DiffViewProps {
  before: string;
  after: string;
  className?: string;
}

/**
 * Inline before/after diff: red strikethrough for deletions, green for
 * insertions, neutral for equal text. Word-level cleanup for readability.
 */
export function DiffView({ before, after, className }: DiffViewProps) {
  const ops = useMemo(() => computeDiff(before, after), [before, after]);
  return (
    <div
      className={cn(
        "text-foreground leading-relaxed whitespace-pre-wrap",
        className,
      )}
    >
      {ops.map((op, i) => (
        <DiffSpan key={i} op={op} />
      ))}
    </div>
  );
}

function DiffSpan({ op }: { op: DiffOp }) {
  if (op.kind === "equal") return <span>{op.text}</span>;
  if (op.kind === "insert") {
    return (
      <span className="bg-success/15 text-success-foreground rounded-sm px-0.5 underline decoration-2 underline-offset-2 decoration-emerald-500">
        {op.text}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground bg-danger/10 rounded-sm px-0.5 line-through decoration-2 decoration-rose-500">
      {op.text}
    </span>
  );
}
