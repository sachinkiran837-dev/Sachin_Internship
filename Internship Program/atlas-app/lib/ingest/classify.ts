import { hasAI, getAnthropicClient, AI_MODEL } from "@/lib/ai/client";

export interface RoleClassification {
  managementLevel: "management" | "individual_contributor";
  clinicalFlag: boolean;
  confidence: number;
  source: "ai" | "fallback";
}

const MANAGEMENT_KEYWORDS = [
  "chief",
  "director",
  "head of",
  "manager",
  "vp",
  "vice president",
  "president",
  "lead",
  "supervisor",
];

const CLINICAL_KEYWORDS = [
  "clinical",
  "nurse",
  "nursing",
  "physician",
  "doctor",
  "medical",
  "therapist",
  "patient",
];

/**
 * Deterministic keyword classifier. Runs unconditionally as the always-on
 * floor, and as the visible fallback when no ANTHROPIC_API_KEY is set.
 */
function classifyByKeyword(title: string): RoleClassification {
  const t = title.toLowerCase();
  const managementLevel = MANAGEMENT_KEYWORDS.some((k) => t.includes(k))
    ? "management"
    : "individual_contributor";
  const clinicalFlag = CLINICAL_KEYWORDS.some((k) => t.includes(k));
  return { managementLevel, clinicalFlag, confidence: 0.6, source: "fallback" };
}

const CLASSIFY_TOOL = {
  name: "classify_role",
  description: "Classify a job title from an operating-model lens.",
  input_schema: {
    type: "object" as const,
    properties: {
      managementLevel: { type: "string", enum: ["management", "individual_contributor"] },
      clinicalFlag: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["managementLevel", "clinicalFlag", "confidence"],
  },
};

/**
 * Classification is advisory framing only — it feeds tags shown to a human
 * reviewer, never a number that reaches a client unchecked. Never the
 * calculator: cost/headcount arithmetic never runs through this path.
 */
export async function classifyRole(
  title: string,
  department: string
): Promise<RoleClassification> {
  const fallback = classifyByKeyword(title);
  if (!hasAI()) return fallback;

  try {
    const client = getAnthropicClient();
    const message = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 256,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "classify_role" },
      messages: [
        {
          role: "user",
          content: `Classify this position from an operating-model lens (management vs individual contributor, and whether it is a clinical/patient-facing role vs corporate).\n\nTitle: ${title}\nDepartment: ${department}`,
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return fallback;

    const input = toolUse.input as {
      managementLevel: "management" | "individual_contributor";
      clinicalFlag: boolean;
      confidence: number;
    };

    return { ...input, source: "ai" };
  } catch {
    // Visible-fallback pattern: an AI call failing degrades to the
    // deterministic path rather than blocking ingest.
    return fallback;
  }
}
