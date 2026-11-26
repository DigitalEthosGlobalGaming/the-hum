// Combine rule resolution (PLAN.md §5.2). Pure: works on ids + defs only.
// Rules live on either side's `components.combine` list; the engine checks both directions.
// `consume` is relative to the rule's owner: "self" = the owner, "other" = the partner.

/**
 * Find the rule for `aId` acting on `bId`.
 * @returns {{ rule, owner: 'a'|'b' } | null}  owner says whose combine list the rule came from
 */
export function findCombine(aId, aDef, bId, bDef) {
  if (!aId || !bId) return null;
  const ra = (aDef?.components?.combine ?? []).find((r) => r?.with === bId);
  if (ra) return { rule: ra, owner: 'a' };
  const rb = (bDef?.components?.combine ?? []).find((r) => r?.with === aId);
  if (rb) return { rule: rb, owner: 'b' };
  return null;
}

/**
 * Turn a rule's `consume` into which of a / b disappear.
 * Accepts "self" | "other" | "both" | "none" (and true = "self", false/undefined = "none").
 */
export function consumeSides(consume, owner) {
  const c = consume === true ? 'self' : consume === false || consume == null ? 'none' : consume;
  const self = c === 'self' || c === 'both';
  const other = c === 'other' || c === 'both';
  return owner === 'a' ? { a: self, b: other } : { a: other, b: self };
}
