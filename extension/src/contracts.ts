export const OWN = "data-denied-ui";
export const MAX_BATCH = 20;
export const DEFAULTS = {
  enabled: false, animate: true, toast: true, mode: "remove" as "remove" | "highlight",
  apiBase: "http://127.0.0.1:8765",
};
export type Settings = typeof DEFAULTS;
export type Reason = "advertising" | "unsafe_content";
export type Counts = { total: number; advertising: number; unsafe_content: number };
export const zeroCounts = (): Counts => ({ total: 0, advertising: 0, unsafe_content: 0 });
export type Candidate = {
  id: string; revision: number; text: string;
  links: { label: string; destination_host: string; destination_scheme: string }[];
  ad: {
    tag: string; tokens: string; label: string;
    source_host: string; source_scheme: string; known_host: boolean;
    attributes?: string[]; network?: string;
  };
};
export type Batch = { document_id: string; page_host: string; page_scheme: string; candidates: Candidate[] };
export type Decision = { id: string; revision: number; ad_score: number; unsafe_score: number; remove: boolean; reasons: Reason[]; receipt?: string | null };
export type Removal = {
  document_id: string; target_id: string; revision: number;
  removed_text: string; text_truncated: boolean;
  detected_at: string; removed_at: string; total_ms: number;
  passages: { receipt: string; text: string }[];
};
export type Judgments = { document_id: string; policy_version: string; results: Decision[] };
export type PageStats = Counts & { checked: number; pending: number; deferred: number; error: string | null; recording_error: string | null };

export function apiBase(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid API URL");
  const url = new URL(value);
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use an HTTPS API origin or a loopback HTTP origin");
  }
  return url.origin;
}

export function settingsFrom(value: unknown): Settings {
  const s = value as Settings;
  if (!s || [s.enabled, s.animate, s.toast].some(v => typeof v !== "boolean") ||
      !["remove", "highlight"].includes(s.mode)) throw new Error("Invalid settings");
  return { enabled: s.enabled, animate: s.animate, toast: s.toast, mode: s.mode, apiBase: apiBase(s.apiBase) };
}

/** Validate the remote boundary without a second schema dependency. */
export function judgmentsFrom(value: unknown, batch: Batch): Judgments {
  const body = value as Judgments;
  if (!body || body.document_id !== batch.document_id || typeof body.policy_version !== "string" ||
      !Array.isArray(body.results) || body.results.length !== batch.candidates.length) {
    throw new Error("Incomplete judgment response");
  }
  const expected = new Map(batch.candidates.map(c => [c.id, c.revision]));
  for (const result of body.results) {
    if (!result || !expected.has(result.id) || expected.get(result.id) !== result.revision ||
        [result.ad_score, result.unsafe_score].some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) ||
        typeof result.remove !== "boolean" || !Array.isArray(result.reasons) ||
        (result.receipt != null && (typeof result.receipt !== "string" || !result.receipt.length || result.receipt.length > 4096)) ||
        result.reasons.some(r => !["advertising", "unsafe_content"].includes(r)) ||
        new Set(result.reasons).size !== result.reasons.length || result.remove !== (result.reasons.length > 0)) {
      throw new Error("Invalid judgment response");
    }
    expected.delete(result.id);
  }
  return body;
}
