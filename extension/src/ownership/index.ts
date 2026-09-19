/** Experimental removal contracts. Predictions can be wrong; this module only enforces scope. */
import { observe, contains, type Observation } from "./observation";
export { observe, contains } from "./observation";
export type { Observation, ObservationNode } from "./observation";
export { proposePlans } from "./plans";
export type { ScopeOption, ScopeOptions } from "./plans";

export type RemovalPlan = {
  observation: Observation;
  roots: string[];
  valid: boolean;
};

/**
 * Collapse only fully approved subtrees. Unknown atoms and excluded branches prevent
 * ancestor removal. The observation root is a scope boundary, never a removal target.
 * Approval is an explicit input, not a classifier or a claim of semantic correctness.
 */
export function planRemoval(observation: Observation, approvedAtoms: readonly string[]): RemovalPlan {
  const approved = new Set(approvedAtoms);
  const atoms = new Set(observation.atoms);
  const valid = observation.complete && approvedAtoms.length === approved.size &&
    [...approved].every(id => atoms.has(id));
  if (!valid) return { observation, roots: [], valid: false };

  const children = new Map<string, string[]>();
  const records = new Map(observation.data.nodes.map(node => [node.id, node]));
  for (const node of observation.data.nodes) {
    if (node.parent) children.set(node.parent, [...(children.get(node.parent) || []), node.id]);
  }
  const covered = new Map<string, boolean>();
  for (const node of [...observation.data.nodes].reverse()) {
    covered.set(node.id, !node.blocked && (!atoms.has(node.id) || approved.has(node.id)) &&
      (children.get(node.id) || []).every(id => covered.get(id)));
  }
  const roots: string[] = [];
  const select = (id: string): void => {
    const node = records.get(id)!;
    if (id !== observation.data.root && node.kind !== "shadow" && covered.get(id)) {
      roots.push(id);
      return;
    }
    for (const child of children.get(id) || []) select(child);
  };
  select(observation.data.root);
  return { observation, roots, valid: true };
}

/**
 * Revalidate immediately before every physical deletion. Custom-element callbacks can
 * synchronously mutate later targets; stop on those changes and report partial completion.
 * No animation or async wait lives here. A future animated caller must commit after its wait.
 */
export function commitRemoval(plan: RemovalPlan, enabled: () => boolean): { removed: string[]; cancelled: boolean } {
  const { observation } = plan;
  const removed: string[] = [];
  const expected = new Map(observation.signatures);
  const current = (): boolean => {
    if (!plan.valid || !enabled() || !observation.root.isConnected || observation.root.ownerDocument.URL !== observation.url) return false;
    const fresh = observe(observation.root, observation.limits);
    return fresh.complete && fresh.signatures.size === expected.size &&
      [...expected].every(([id, signature]) => fresh.signatures.get(id) === signature);
  };
  if (!current()) return { removed, cancelled: true };
  for (const id of plan.roots) {
    if (!current()) return { removed, cancelled: true };
    const node = observation.refs.get(id)!;
    // The expected next snapshot excludes exactly our own deleted subtree, not changes
    // from page callbacks. Physical shadow ancestry is used, never visual proximity.
    for (const [childId, child] of observation.refs) {
      if (contains(node, child)) expected.delete(childId);
    }
    node.parentNode!.removeChild(node);
    removed.push(id);
  }
  return { removed, cancelled: false };
}
