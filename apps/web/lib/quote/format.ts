// Small display helpers for the quote UI (TOV-176 / FR-06.03).

// Truncate a long id (uuid) to a compact, human-scannable form: first 8 chars + ellipsis.
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
