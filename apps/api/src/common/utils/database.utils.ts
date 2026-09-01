/**
 * True when `err` is a Postgres unique-violation (SQLSTATE 23505). When `constraint` is given, ALSO
 * requires `err.constraint` to match that exact index/constraint name — so a caller with multiple unique
 * indexes on one table (e.g. KYC's one-pending-per-user vs. one-doc-per-type, TOV-28 DI-H1) can map only
 * the intended violation and rethrow the rest. Never `.includes`/positional-match a constraint name.
 */
export function isUniqueConstraintError(err: unknown, constraint?: string): boolean {
  if (
    typeof err !== 'object' ||
    err === null ||
    !('code' in err) ||
    (err as Record<string, unknown>).code !== '23505'
  ) {
    return false;
  }
  if (constraint === undefined) {
    return true;
  }
  return (err as Record<string, unknown>).constraint === constraint;
}
