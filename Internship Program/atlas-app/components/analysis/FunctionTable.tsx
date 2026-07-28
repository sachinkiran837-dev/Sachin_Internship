import { COMPARISON_OUTLIER_MULTIPLE, type UnitComparison } from "@/lib/analysis/functions";
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
 * The organisation laid out against itself, one row per part.
 *
 * Every finding on the screen above this table is a sentence about one of
 * these rows, and a client's first response to any of them is "compared to
 * what?". This is the answer, in full, including the units that were not
 * called out — a comparison that only shows the losers is an argument, not a
 * measurement.
 *
 * The median row is the benchmark itself, made visible. It is the only
 * benchmark Atlas uses.
 */

function currency(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
    notation: n >= 1_000_000 ? "compact" : "standard",
  }).format(n);
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export function FunctionTable({
  comparison,
  choice,
}: {
  comparison: UnitComparison;
  choice: string;
}) {
  const { medians, units, label } = comparison;
  const showRevenue = units.some((u) => u.revenuePerHead !== null);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{label} by {label.toLowerCase()}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{choice}</p>
        {comparison.limitation && (
          <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
            {comparison.limitation}
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{label}</TableHead>
              <TableHead className="text-right">People</TableHead>
              <TableHead className="text-right">FTE</TableHead>
              <TableHead className="text-right">Management</TableHead>
              <TableHead className="text-right">Per manager</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Cost / FTE</TableHead>
              <TableHead className="text-right">Agency</TableHead>
              {showRevenue && <TableHead className="text-right">Revenue / head</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.map((u) => {
              // Never against a median of zero: where most units carry no
              // managers, every unit with one would light up red and the
              // column would be reporting a gap in the data as a finding.
              const heavy =
                medians.managerShare !== null &&
                medians.managerShare > 0 &&
                u.comparable &&
                u.managerShare >= medians.managerShare * COMPARISON_OUTLIER_MULTIPLE;
              return (
                <TableRow key={u.key} className={u.comparable ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {u.key}
                      {!u.comparable && (
                        <Badge variant="outline" className="font-normal">
                          too small to compare
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{u.headcount.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{u.fte.toFixed(0)}</TableCell>
                  <TableCell className={`text-right ${heavy ? "font-semibold text-destructive" : ""}`}>
                    {pct(u.managerShare)}
                  </TableCell>
                  <TableCell className="text-right">
                    {u.staffPerManager === null ? "—" : u.staffPerManager.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right">{currency(u.cost)}</TableCell>
                  <TableCell className="text-right">
                    {u.costPerFte === null ? (
                      <span className="text-muted-foreground">not priced</span>
                    ) : (
                      currency(u.costPerFte)
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {u.agency === 0 ? "—" : pct(u.agencyShare)}
                  </TableCell>
                  {showRevenue && (
                    <TableCell className="text-right">
                      {u.revenuePerHead === null ? (
                        <span className="text-muted-foreground">not supplied</span>
                      ) : (
                        currency(u.revenuePerHead)
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}

            {/* The benchmark, on the same screen as the things measured
                against it. Nothing here is compared to an outside number. */}
            <TableRow className="border-t-2 bg-muted/40 font-medium">
              <TableCell>
                Median of the {comparison.comparableUnits.length} comparable
              </TableCell>
              <TableCell className="text-right">—</TableCell>
              <TableCell className="text-right">—</TableCell>
              <TableCell className="text-right">
                {medians.managerShare === null ? "—" : pct(medians.managerShare)}
              </TableCell>
              <TableCell className="text-right">
                {medians.staffPerManager === null ? "—" : medians.staffPerManager.toFixed(1)}
              </TableCell>
              <TableCell className="text-right">—</TableCell>
              <TableCell className="text-right">
                {medians.costPerFte === null ? "—" : currency(medians.costPerFte)}
              </TableCell>
              <TableCell className="text-right">—</TableCell>
              {showRevenue && (
                <TableCell className="text-right">
                  {medians.revenuePerHead === null ? "—" : currency(medians.revenuePerHead)}
                </TableCell>
              )}
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        {comparison.classified.toLocaleString()} of{" "}
        {(comparison.classified + comparison.unclassified).toLocaleString()} positions carry a{" "}
        {label.toLowerCase()} ({pct(comparison.coverage)}).
        {comparison.unclassified > 0 &&
          ` The other ${comparison.unclassified.toLocaleString()} are in no row above and in no median.`}
      </p>
    </div>
  );
}
