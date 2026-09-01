import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { offeringEscrowConfig } from '../../../src/config/offering-escrow.config';

/**
 * Config-factory validation for the offering-escrow deploy + multi-sig approval quorum (TOV-154). The
 * factory (a `registerAs` callable) both parses env AND fails-fast on invariants Joi can't express:
 * threshold ≤ roster size, a distinct roster, UUID-only entries. It also attaches the signing seed
 * NON-ENUMERABLE so it can't leak via logging / JSON.stringify / spread / Object.keys.
 */
const SIGNER_A = '11111111-1111-4111-8111-111111111111';
const SIGNER_B = '22222222-2222-4222-8222-222222222222';
const SIGNER_C = '33333333-3333-4333-8333-333333333333';

// A real, valid Stellar secret so `Keypair.fromSecret` inside the factory derives a pubkey (never throws).
const VALID_SECRET = Keypair.random().secret();

let savedEnv: NodeJS.ProcessEnv;

function setBaseEnv(): void {
  process.env.OFFERING_ESCROW_ADMIN_SECRET = VALID_SECRET;
  process.env.OFFERING_APPROVAL_SIGNERS = `${SIGNER_A},${SIGNER_B},${SIGNER_C}`;
  process.env.OFFERING_APPROVAL_THRESHOLD = '2';
}

beforeEach(() => {
  // Snapshot + strip the env keys this factory reads, so each case starts from a known base.
  savedEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('OFFERING_')) delete process.env[k];
  }
});

afterEach(() => {
  process.env = savedEnv;
});

describe('offeringEscrowConfig (valid env)', () => {
  it('returns the parsed quorum with a non-enumerable adminSecret', () => {
    setBaseEnv();
    const cfg = offeringEscrowConfig();

    expect(cfg.signers).toHaveLength(3);
    expect(cfg.threshold).toBe(2);
    expect(cfg.signerSet.has(SIGNER_A)).toBe(true);
    expect(cfg.signerSet.has(SIGNER_B)).toBe(true);
    expect(cfg.signerSet.has(SIGNER_C)).toBe(true);
    expect(cfg.adminPublicKey).not.toBe('');
    expect(cfg.adminPublicKey).toBe(Keypair.fromSecret(VALID_SECRET).publicKey());

    // adminSecret is present for the signer but NON-ENUMERABLE (never leaks via Object.keys / spread / JSON).
    expect(cfg.adminSecret).toBe(VALID_SECRET);
    expect(Object.keys(cfg)).not.toContain('adminSecret');
    expect(JSON.stringify(cfg)).not.toContain(VALID_SECRET);
    expect({ ...cfg }).not.toHaveProperty('adminSecret');
  });
});

describe('offeringEscrowConfig (boot-time invariant throws)', () => {
  it('throws when threshold is below the multi-sig floor of 2 (todo 284)', () => {
    process.env.OFFERING_APPROVAL_SIGNERS = `${SIGNER_A},${SIGNER_B},${SIGNER_C}`;
    process.env.OFFERING_APPROVAL_THRESHOLD = '1';
    expect(() => offeringEscrowConfig()).toThrow(/must be at least 2/);
  });

  it('throws when threshold exceeds the signer roster size', () => {
    setBaseEnv();
    process.env.OFFERING_APPROVAL_SIGNERS = `${SIGNER_A},${SIGNER_B}`;
    process.env.OFFERING_APPROVAL_THRESHOLD = '3';
    expect(() => offeringEscrowConfig()).toThrow(/exceeds OFFERING_APPROVAL_SIGNERS count/);
  });

  it('throws when the signer roster contains duplicates', () => {
    setBaseEnv();
    process.env.OFFERING_APPROVAL_SIGNERS = `${SIGNER_A},${SIGNER_A},${SIGNER_B}`;
    expect(() => offeringEscrowConfig()).toThrow(/duplicate admin UUIDs/);
  });

  it('throws when a signer entry is not a UUID', () => {
    setBaseEnv();
    process.env.OFFERING_APPROVAL_SIGNERS = `${SIGNER_A},not-a-uuid,${SIGNER_C}`;
    expect(() => offeringEscrowConfig()).toThrow(/non-UUID entry/);
  });
});
