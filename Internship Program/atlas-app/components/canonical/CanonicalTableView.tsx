"use client";

import { useMemo, useState } from "react";
import { currency } from "@/lib/format/currency";
import { buildFacets, bandOf, NOT_STATED, type Facet } from "@/lib/canonical/facets";
import type { CanonicalRow } from "@/lib/canonical/table";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The clean table, filterable from its own header row.
 *
 * The facets are the same ones the map offers — built by the same function,
 * from these same rows — so a column with one distinct value still has
 * nothing to filter on here either, and "Function" means the same thing on
 * both screens. Employee and Job title aren't facets (hundreds of distinct
 * values each): they get a plain contains-match box instead, which is the
 * right control for a column a dropdown can't usefully list.
 */

const ALL = "all";

export interface CanonicalTableViewProps {
  rows: CanonicalRow[];
  brandLabel: string;
  previewRows: number;
}

function readFacetValue(facet: Facet, row: CanonicalRow): string {
  if (facet.kind === "band") {
    const raw = facet.key === "fte" ? row.fte : facet.key === "salary" ? row.salary : row.annualCost;
    return bandOf(facet, raw);
  }
  const text =
    facet.key === "function"
      ? row.department
      : facet.key === "departmentAsStated"
        ? row.departmentAsStated
        : facet.key === "manager"
          ? row.manager
          : facet.key === "employmentType"
            ? row.employmentType
            : row.brand;
  const value = text.trim();
  return value === "" ? NOT_STATED : value;
}

export function CanonicalTableView({ rows, brandLabel, previewRows }: CanonicalTableViewProps) {
  const facets = useMemo(
    () => buildFacets({ rows, brandLabel, coverage: [] }, {}),
    [rows, brandLabel]
  );
  const facetByKey = useMemo(() => new Map(facets.map((f) => [f.key, f] as const)), [facets]);

  const [selection, setSelection] = useState<Record<string, string>>({});
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [titleQuery, setTitleQuery] = useState("");
  const [managerQuery, setManagerQuery] = useState("");

  const managerFacet = facetByKey.get("manager");

  const active = useMemo(
    () => Object.entries(selection).filter(([, v]) => v && v !== ALL),
    [selection]
  );
  const hasActiveFilter =
    active.length > 0 ||
    employeeQuery.trim() !== "" ||
    titleQuery.trim() !== "" ||
    (managerQuery.trim() !== "" && !managerFacet);

  const filteredRows = useMemo(() => {
    if (!hasActiveFilter) return rows;
    const eq = employeeQuery.trim().toLowerCase();
    const tq = titleQuery.trim().toLowerCase();
    const mq = managerQuery.trim().toLowerCase();
    return rows.filter((row) => {
      for (const [key, want] of active) {
        const facet = facetByKey.get(key);
        if (facet && readFacetValue(facet, row) !== want) return false;
      }
      if (eq && !row.employee.toLowerCase().includes(eq)) return false;
      if (tq && !row.title.toLowerCase().includes(tq)) return false;
      if (mq && !managerFacet && !row.manager.toLowerCase().includes(mq)) return false;
      return true;
    });
  }, [rows, hasActiveFilter, active, facetByKey, employeeQuery, titleQuery, managerQuery, managerFacet]);

  const clearFilters = () => {
    setSelection({});
    setEmployeeQuery("");
    setTitleQuery("");
    setManagerQuery("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {hasActiveFilter
            ? `${filteredRows.length.toLocaleString()} of ${rows.length.toLocaleString()} rows match`
            : `${rows.length.toLocaleString()} rows`}
        </span>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="h-7 rounded-md border border-input px-2 text-xs hover:bg-accent hover:text-accent-foreground"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="align-top hover:bg-transparent">
              <ColumnHead label="Employee">
                <TextFilter value={employeeQuery} onChange={setEmployeeQuery} placeholder="Filter…" />
              </ColumnHead>
              <ColumnHead label="Job title">
                <TextFilter value={titleQuery} onChange={setTitleQuery} placeholder="Filter…" />
              </ColumnHead>
              <ColumnHead label="Function">
                <FacetFilter facet={facetByKey.get("function")} selection={selection} setSelection={setSelection} />
              </ColumnHead>
              <ColumnHead label="Department">
                <FacetFilter
                  facet={facetByKey.get("departmentAsStated")}
                  selection={selection}
                  setSelection={setSelection}
                />
              </ColumnHead>
              <ColumnHead label={brandLabel}>
                <FacetFilter
                  facet={facetByKey.get(brandLabel.toLowerCase())}
                  selection={selection}
                  setSelection={setSelection}
                />
              </ColumnHead>
              <ColumnHead label="Manager">
                {managerFacet ? (
                  <FacetFilter facet={managerFacet} selection={selection} setSelection={setSelection} />
                ) : (
                  <TextFilter value={managerQuery} onChange={setManagerQuery} placeholder="Filter…" />
                )}
              </ColumnHead>
              <ColumnHead label="Employment">
                <FacetFilter
                  facet={facetByKey.get("employmentType")}
                  selection={selection}
                  setSelection={setSelection}
                />
              </ColumnHead>
              <ColumnHead label="FTE" align="right">
                <FacetFilter facet={facetByKey.get("fte")} selection={selection} setSelection={setSelection} />
              </ColumnHead>
              <ColumnHead label="Salary" align="right">
                <FacetFilter facet={facetByKey.get("salary")} selection={selection} setSelection={setSelection} />
              </ColumnHead>
              <ColumnHead label="Annual cost" align="right">
                <FacetFilter
                  facet={facetByKey.get("annualCost")}
                  selection={selection}
                  setSelection={setSelection}
                />
              </ColumnHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.slice(0, previewRows).map((r, i) => (
              <TableRow key={i} title={r.flags.join(" · ")}>
                <TableCell className="font-medium">{r.employee}</TableCell>
                <TableCell className="text-muted-foreground">{r.title}</TableCell>
                <TableCell>{r.department || <Missing />}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.departmentAsStated || <Missing />}
                </TableCell>
                <TableCell>{r.brand || <Missing />}</TableCell>
                <TableCell>{r.manager || <Missing />}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      r.employmentType === "Agency" || r.employmentType === "Vacant"
                        ? "outline"
                        : "secondary"
                    }
                    className="font-normal"
                  >
                    {r.employmentType}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.fte.toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.salary === null ? <Missing /> : currency(r.salary)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.annualCost > 0 ? currency(r.annualCost) : <Missing />}
                </TableCell>
              </TableRow>
            ))}
            {filteredRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                  No rows match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {filteredRows.length > previewRows && (
        <p className="text-xs text-muted-foreground">
          Showing the first {previewRows.toLocaleString()} of {filteredRows.length.toLocaleString()}{" "}
          matching rows.
        </p>
      )}
    </div>
  );
}

function ColumnHead({
  label,
  align = "left",
  children,
}: {
  label: string;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <div className={`flex flex-col gap-1 ${align === "right" ? "items-end" : "items-start"}`}>
        <span>{label}</span>
        {children}
      </div>
    </TableHead>
  );
}

function TextFilter({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-7 w-full max-w-32 rounded-md border border-input bg-transparent px-1.5 text-xs font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );
}

function FacetFilter({
  facet,
  selection,
  setSelection,
}: {
  facet: Facet | undefined;
  selection: Record<string, string>;
  setSelection: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  if (!facet) return null;
  return (
    <select
      value={selection[facet.key] ?? ALL}
      onChange={(e) => {
        const v = e.target.value;
        setSelection((prev) => ({ ...prev, [facet.key]: v }));
      }}
      className="h-7 max-w-32 rounded-md border border-input bg-transparent px-1 text-xs font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <option value={ALL}>All</option>
      {facet.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label} ({option.count.toLocaleString()})
        </option>
      ))}
    </select>
  );
}

/** An empty cell that says it is empty, rather than looking like a zero. */
function Missing() {
  return <span className="text-xs text-muted-foreground">not stated</span>;
}
