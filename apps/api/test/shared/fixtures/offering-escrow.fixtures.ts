import { OfferingConstructorArgs } from '../../../src/modules/offerings/escrow/offering-escrow.service.interface';

/**
 * Contract facts + stable test vectors for the OfferingEscrow deploy (TOV-154, WS0 merged into WS5).
 * The keypair is DETERMINISTIC (derived from a fixed 32-byte ed25519 seed, `Buffer.alloc(32, 7)`) so the
 * golden escrow address never drifts between runs; it is throwaway (testnet-only, never funded).
 */

/** Published `tove_offering_escrow.wasm` hash (hex 64) — the self-heal / config pin. */
export const OFFERING_ESCROW_WASM_HASH =
  'd171963cff32da75c385c02724793d37e187142564582c8eda82deddf23bfc86';

/** Testnet USDC SAC address baked into every escrow constructor (`OFFERING_ESCROW_USDC_ADDRESS`). */
export const OFFERING_ESCROW_USDC_ADDRESS =
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Stable throwaway testnet keypair — the deploy source / escrow admin (admin-as-source, D7). */
export const FIXTURE_ADMIN_PUBLIC_KEY = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
export const FIXTURE_ADMIN_SECRET = 'SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X';

/** A sample artist address (distinct valid testnet G-account) for constructor-arg vectors. */
export const FIXTURE_ARTIST_ADDRESS = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';

/** A fixed offering id whose golden escrow address is pinned below. */
export const FIXTURE_OFFERING_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Golden escrow address = deriveOfferingEscrowAddress(FIXTURE_ADMIN_PUBLIC_KEY,
 * escrowSalt(FIXTURE_OFFERING_ID), TESTNET_PASSPHRASE). Pins the off-chain derivation.
 */
export const FIXTURE_GOLDEN_ESCROW_ADDRESS =
  'CACROGOVG7UN5GZVSRL6BFLNOVB4BTVKDQYLJS72RE5EVZKW56RLSQ3T';

/** A sample, ABI-ordered constructor-arg record for the encoder golden-vector test. */
export const FIXTURE_CONSTRUCTOR_ARGS: OfferingConstructorArgs = {
  usdc: OFFERING_ESCROW_USDC_ADDRESS,
  totalSupply: 1_000_000n,
  artist: FIXTURE_ARTIST_ADDRESS,
  artistRetention: 100_000n,
  treasury: OFFERING_ESCROW_USDC_ADDRESS,
  treasuryRetention: 50_000n,
  artistPayout: FIXTURE_ARTIST_ADDRESS,
  admin: FIXTURE_ADMIN_PUBLIC_KEY,
};
