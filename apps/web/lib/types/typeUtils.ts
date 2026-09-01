// Shared compile-time type utilities.

// Exact-equality check (invariant-position trick): `Equals<A, B>` is `true` iff A and B are mutually
// assignable, `false` otherwise. Used with a `const _x: Equals<Infer, Domain> = true` assertion as a
// drift guard — a schema/domain mismatch makes `true` unassignable to `false`, so the build goes red.
// Prefer this over a one-way `A extends B ? true : never` when you want EXACT equality (both directions).
// For a deliberate one-way ASSIGNABILITY / COMPLETENESS assertion (e.g. "this union is covered by that
// array"), keep the one-directional `extends` form — that is a different, intentional check.
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
