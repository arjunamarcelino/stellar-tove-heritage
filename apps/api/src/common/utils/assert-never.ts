/**
 * Exhaustiveness guard: reaching this is a compile error when a discriminated-union `switch` is missing
 * a case (the argument narrows to `never` only if every case is handled). Throws at runtime as a
 * defensive backstop for an unexpected value (e.g. a DB row with a status the code doesn't know).
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
