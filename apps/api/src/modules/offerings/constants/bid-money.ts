import { MAX_STROOPS } from '@common/constants/stroops.constant';

/**
 * Compute a bid's escrow amount (`price × count`) in USDC stroops, using BigInt math end to end
 * (dependency-free leaf; imports only the sibling `stroops.constant`). Both inputs are canonical
 * non-negative integer strings (`STROOPS_RE`-validated at the DTO layer); the result is a canonical string.
 *
 * The `bigint`-only signature is the compile-time bar against a `Number()` coercion on money (stroops
 * exceed 2^53). Enforces the same 2^96−1 ceiling as the on-chain USDC amount — a product above it could not
 * be transferred — throwing `RangeError` so the caller maps it to a clean 422 rather than a silent overflow.
 * Mirrors the offerings money discipline (numeric(39,0) → string; the DB has a matching `CHK_bid_escrow_cap`).
 */
export function computeEscrowStroops(priceStroops: string, count: string): string {
  const price = BigInt(priceStroops);
  const qty = BigInt(count);
  if (price <= 0n || qty <= 0n) {
    throw new RangeError('price and count must be positive');
  }
  const escrow = price * qty;
  if (escrow > MAX_STROOPS) {
    throw new RangeError('escrow amount exceeds MAX_STROOPS');
  }
  return escrow.toString();
}
