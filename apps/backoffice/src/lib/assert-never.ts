/**
 * Compile-time exhaustiveness guard. Call in the `default` branch of a `switch` over a union so that
 * adding a new variant becomes a type error until every branch is handled. Throws if ever reached at
 * runtime (a malformed value that bypassed schema validation).
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
