import { contains, type Observation } from "./observation";

export type ScopeOption = { id: string; atoms: string[] };
export type ScopeOptions = { options: ScopeOption[]; complete: boolean };

/**
 * Enumerate alternative physical scopes without classifying their content.
 * Options include ancestors with a preserved run of sibling subtrees at any depth.
 * A reply list need not have an enclosing wrapper: a run can contain any number of
 * siblings. This bounded grammar does not enumerate every discontiguous tree mask.
 * Equivalent coverage sets are deduplicated; visual styles and site-specific names
 * never decide which scope wins. The model must select or abstain separately.
 */
export function proposePlans(observation: Observation, anchor: Element, maxOptions = 64): ScopeOptions {
  const options: ScopeOption[] = [{ id: "none", atoms: [] }];
  if (!observation.complete || !Number.isInteger(maxOptions) || maxOptions < 2 ||
      ![...observation.refs.values()].includes(anchor) ||
      !observation.atoms.some(id => contains(anchor, observation.refs.get(id)!))) {
    return { options, complete: false };
  }

  let complete = true;
  const seen = new Set([""]);
  const coverage = new Map(observation.data.nodes.map(node => [node.id,
    observation.atoms.filter(id => contains(observation.refs.get(node.id)!, observation.refs.get(id)!))]));
  const children = new Map<string, string[]>();
  for (const node of observation.data.nodes) {
    if (node.parent) children.set(node.parent, [...(children.get(node.parent) || []), node.id]);
  }
  const add = (atoms: string[]): void => {
    const key = [...atoms].sort().join(",");
    if (seen.has(key)) return;
    seen.add(key);
    if (options.length >= maxOptions) {
      complete = false;
      return;
    }
    options.push({ id: `scope_${options.length}`, atoms });
  };
  const ancestors = [...observation.data.nodes].reverse().filter(node => node.kind === "element" &&
    node.id !== observation.data.root && contains(observation.refs.get(node.id)!, anchor));
  for (const ancestor of ancestors) {
    const atoms = coverage.get(ancestor.id)!;
    add(atoms);
    for (const siblings of children.values()) {
      for (let start = 0; start < siblings.length; start++) {
        const excluded = new Set<string>();
        for (let end = start; end < siblings.length; end++) {
          const id = siblings[end];
          const node = observation.refs.get(id)!;
          if (!contains(observation.refs.get(ancestor.id)!, node) ||
              contains(node, anchor) || contains(anchor, node)) break;
          for (const atom of coverage.get(id)!) excluded.add(atom);
          add(atoms.filter(atom => !excluded.has(atom)));
          if (!complete) return { options, complete };
        }
      }
    }
  }
  return { options, complete };
}
