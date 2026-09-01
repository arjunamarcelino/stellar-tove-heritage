/**
 * bigint <-> number transformer for Soroban ledger sequences. A ledger sequence is far below 2^53, so
 * `Number()` is precision-safe here (unlike `amount_scaled`, which stays a BigInt decimal string). Shared by the
 * export item, rotation item, and registry-event ledger columns (todo 434 — was inlined/duplicated per entity).
 */
export const ledgerNumberTransformer = {
  to: (v: number | null): number | null => v,
  from: (v: string | null): number | null => (v === null ? null : Number(v)),
};
