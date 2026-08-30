import type { Assessment, Fingerprint } from "../../shared/schema/types.js";
import { automationRules } from "./rules/automation.js";
import { consistencyRules } from "./rules/consistency.js";
import { identifiabilityRules } from "./rules/identifiability.js";

type Rule = (fp: Fingerprint) => Assessment[];

/** Register new rules here. Each is a pure `(Fingerprint) => Assessment[]`; see rules/*.ts. */
const RULES: Rule[] = [automationRules, consistencyRules, identifiabilityRules];

export function runInterpretation(fp: Fingerprint): Assessment[] {
  const assessments: Assessment[] = [];
  for (const rule of RULES) {
    try {
      assessments.push(...rule(fp));
    } catch (err) {
      // A single misbehaving rule should never take down fingerprint generation.
      assessments.push({
        id: `interpretation_error.${rule.name || "anonymous_rule"}`,
        category: "general",
        title: "Interpretation rule failed",
        statement: `An internal rule (${rule.name || "anonymous"}) threw an error and was skipped: ${(err as Error).message}`,
        confidence: "informational",
        evidence: { observationIds: [], derivedIds: [] },
      });
    }
  }
  return assessments;
}
