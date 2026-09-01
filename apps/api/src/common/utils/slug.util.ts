/**
 * Derive a stable, URL-safe artwork slug from its title + id (TOV-237). There is no persisted `slug`
 * column: the value is a pure function of `title` + `id`, so it is derived at response time. Shared by the
 * holdings (`me/holdings`) and RFQ-notifications (`me/notifications`) read DTOs — relocated to `@common`
 * (TOV-174 review #367) so neither surface reaches into another domain for it. The 8-hex-of-uuid suffix keeps
 * it effectively unique even when two titles kebab identically;
 * the leading/trailing-hyphen trim + `'artwork'` fallback keep punctuation/Unicode-only titles readable
 * (e.g. `"#Midnight"` → `midnight-…`, `"你好世界"` → `artwork-…`).
 */
export function slugFallback(title: string, id: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const stem = base || 'artwork';
  const suffix = id.replace(/-/g, '').slice(0, 8);
  return `${stem}-${suffix}`;
}
