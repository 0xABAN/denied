/** Site adapters describe ownership, never advertising or safety judgments. */
export type ItemRule = {
  /** A known single-item wrapper, or a detail-page wrapper with explicit parts. */
  selector: string;
  /** Require an item-specific body/title; avoids matching loading/layout shells. */
  content?: string;
  /** For disjoint presentations, only these descendants belong to the item. */
  parts?: string;
  /** Independent replies/reviews or site controls inside the wrapper. */
  preserve?: string;
  /** A leading row's identity can also label following, headerless messages. */
  sharedIdentity?: { selector: string; row?: string };
};

export type SiteAdapter = {
  id: string;
  /** Exact hosts; a leading dot explicitly permits the domain and its subdomains. */
  hosts: readonly string[];
  routes?: RegExp;
  excludedRoutes?: RegExp;
  protected?: string;
  rules: readonly ItemRule[];
};

/** Browser-local references. Never serialize these or site IDs/URLs to the API. */
export type ItemScope = {
  adapter: string;
  key: HTMLElement;
  regions: HTMLElement[];
  preserved: Element[];
  nodes: (HTMLElement | Text)[];
};
