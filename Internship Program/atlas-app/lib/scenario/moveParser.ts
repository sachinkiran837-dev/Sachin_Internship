export type ParsedMove =
  | { kind: "flatten"; subject: string; layers: number }
  | { kind: "merge"; from: string; into: string }
  | { kind: "remove"; target: string }
  | { kind: "reassign"; target: string; newManager: string }
  | { kind: "add"; title: string; department: string; managerNeedle: string; cost: number }
  | { kind: "unrecognized"; raw: string };

/**
 * Regex/keyword parsing of a plain-English scenario move — a deliberate v1
 * shortcut per the scenario-model skill spec, not a real model call. No
 * known-pattern match returns "unrecognized", never a silent no-op or a
 * hallucinated move.
 */
export function parseScenarioText(text: string): ParsedMove {
  const t = text.trim();

  const flattenMatch = t.match(/flatten\s+(.+?)\s+to\s+(\d+)\s+layers?/i);
  if (flattenMatch) {
    return { kind: "flatten", subject: flattenMatch[1].trim(), layers: parseInt(flattenMatch[2], 10) };
  }

  const mergeMatch = t.match(/merge\s+(.+?)\s+into\s+(.+?)(?:\s+as\s+a\s+shared\s+service)?$/i);
  if (mergeMatch) {
    return { kind: "merge", from: mergeMatch[1].trim(), into: mergeMatch[2].trim() };
  }

  const reassignMatch = t.match(/reassign\s+(.+?)\s+to\s+(.+)/i);
  if (reassignMatch) {
    return { kind: "reassign", target: reassignMatch[1].trim(), newManager: reassignMatch[2].trim() };
  }

  const addMatch = t.match(
    /add\s+(?:a\s+|an\s+)?(.+?)\s+(?:in|under|reporting to)\s+(.+?)(?:\s+at\s+\$?([\d,]+))?$/i
  );
  if (addMatch) {
    return {
      kind: "add",
      title: addMatch[1].trim(),
      department: addMatch[2].trim(),
      managerNeedle: addMatch[2].trim(),
      cost: addMatch[3] ? parseInt(addMatch[3].replace(/,/g, ""), 10) : 0,
    };
  }

  const removeMatch = t.match(/remove\s+(.+)/i);
  if (removeMatch) {
    return { kind: "remove", target: removeMatch[1].trim() };
  }

  return { kind: "unrecognized", raw: t };
}
