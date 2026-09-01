import { Address, StrKey, xdr } from '@stellar/stellar-sdk';
import { KycAllowlistBadAddressError } from './kyc-allowlist.errors';

/**
 * Encode a Collector wallet StrKey as the `Address` scVal argument for `kyc-allowlist.add(addr)` /
 * `.remove(addr)` / `.is_allowed(addr)` (TOV-235; G-address support TOV-243). Accepts BOTH a Collector
 * smart-wallet **contract** StrKey (`C…`) and a BYOW classic **account** StrKey (`G…`) — the on-chain
 * `KycAllowlist` and `Address.fromString` both take any `Address`; the C-only restriction was purely a
 * backend guardrail. A G-address encodes to the `ScAddress → account` arm (an extra `PublicKey` discriminant
 * the contract arm lacks), so it must be golden-vector-pinned separately — fake-backed tests can't catch an
 * on-chain encoding bug (TOV-233 lesson). Validates the full StrKey (CRC16 checksum via the SDK predicates),
 * not just the base32 shape, so a typo can't encode a different-but-valid-looking address.
 *
 * The guard stays an EXPLICIT allowlist of exactly {contract, ed25519-account}. In stellar-sdk v15
 * `Address.fromString` also accepts muxed (`M…`), claimable-balance (`B…`), and liquidity-pool (`L…`)
 * StrKeys (Protocol 23 / CAP-67), so it is NOT a backstop here — this guard is the sole stop for those
 * kinds. Never refactor to "construct `Address` and catch."
 */
export function walletToScVal(wallet: string): xdr.ScVal {
  // NB: the G-or-C rule is expressed in FOUR lockstep places (a shared predicate would invert the neutral→
  // backoffice module dependency, so they can't be merged). Re-widen/re-narrow all together:
  //   (1) this guard, (2) `isValidStrKeyAddress` in backoffice `dto/kyc-allowlist-item.dto.ts` (drives the
  //   POST validator + the GET pipe), (3) the DB CHECK `^[GC][A-Z2-7]{55}$` in migration 1716000000057,
  //   (4) the D7 `isValidEd25519PublicKey` account filter in `backoffice-kyc-allowlist.service.ts`.
  if (!(StrKey.isValidContract(wallet) || StrKey.isValidEd25519PublicKey(wallet))) {
    throw new KycAllowlistBadAddressError(
      `wallet is not a valid Stellar account (G…) or contract (C…) StrKey: ${wallet}`,
    );
  }
  return Address.fromString(wallet).toScVal();
}
