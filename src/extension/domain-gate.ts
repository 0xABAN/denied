import type { DomainRequest } from "./contracts";

export function domainRequest(documentId: string, host: string, protocol: string): DomainRequest {
  if (!documentId || documentId.length > 80 || !host || host.length > 253 ||
      (protocol !== "http:" && protocol !== "https:")) throw new Error("Invalid domain context");
  return { document_id: documentId, page_host: host, page_scheme: protocol.slice(0, -1) as "http" | "https" };
}

export function blockedPageUrl(extensionRoot: string): string {
  return new URL("blocked.html", extensionRoot.endsWith("/") ? extensionRoot : `${extensionRoot}/`).toString();
}
