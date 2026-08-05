"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * The shape of a message with its specifics removed, so two reports of the
 * same problem about two different people compare equal.
 *
 * Quoted names, parenthesised asides and numbers are what vary between one
 * orphan and the next; everything left is the problem itself.
 */
function shape(detail: string): string {
  return detail
    .replace(/"[^"]*"/g, '""')
    .replace(/\([^)]*\)/g, "()")
    .replace(/\b\d[\d,.]*\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One line per kind of problem, not one per occurrence.
 *
 * Four hundred identical orphan messages are not four hundred things to read —
 * they are one thing, four hundred times, and printing them all is how a
 * reviewer learns to scroll past this card instead of reading it. The first of
 * each kind is shown in full, because the specifics in it are a worked example
 * of the rest.
 */
function condense(items: { id: string; detail: string }[]) {
  const groups = new Map<string, { id: string; detail: string; more: number }>();

  for (const item of items) {
    const key = shape(item.detail);
    const existing = groups.get(key);
    if (existing) existing.more++;
    else groups.set(key, { id: item.id, detail: item.detail, more: 0 });
  }

  return [...groups.values()];
}

/**
 * One line, always: a count and what kind of problem it is. The list behind
 * it — which rows, which columns, worked examples of each kind — is closed by
 * default, because the number and the label are what tells someone whether
 * this needs their attention at all.
 */
export function IssueGroup({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "destructive" | "secondary" | "outline";
  items: { id: string; detail: string }[];
}) {
  const [open, setOpen] = useState(false);
  const condensed = condense(items);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-2 text-left"
      >
        <Badge variant={tone}>{items.length}</Badge>
        <span className="font-medium">{title}</span>
        {condensed.length < items.length && (
          <span className="text-xs text-muted-foreground">
            {condensed.length} distinct {condensed.length === 1 ? "kind" : "kinds"}
          </span>
        )}
        <ChevronDown
          className={`ml-auto size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5 border-l pl-3 text-muted-foreground">
          {condensed.map((i) => (
            <li key={i.id}>
              {i.detail}
              {i.more > 0 && (
                <span className="ml-1.5 whitespace-nowrap rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                  +{i.more.toLocaleString()} more like this
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
