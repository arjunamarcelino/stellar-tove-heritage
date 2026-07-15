import { describe, it, expect } from 'vitest';
import { deriveWalletAddress } from '../../../../src/modules/relayer/wallet-address';

// Real @stellar/stellar-sdk (no mock) — this is the ONLY CI guard on the off-chain derivation.
// It pins deriveWalletAddress against a fixed (factory, salt, passphrase) so an accidental change to
// the contract-id preimage construction fails the build. It does NOT prove the address matches the
// real factory deploy (that's the gated RELAYER_LIVE_TESTNET test); it locks our derivation code.
describe('deriveWalletAddress (golden vector)', () => {
  const FACTORY = 'CAZOVWDKGNPMSF7GJ3FKW7M7WGTQDUKDGC3VNVSN4TQYCXBHT53LHEZC';
  const PASSPHRASE = 'Test SDF Network ; September 2015';
  const salt = Buffer.alloc(32, 7); // fixed, deterministic

  it('pins the derived address for a fixed (factory, salt, passphrase)', () => {
    // Golden value — regenerate ONLY if the derivation is intentionally changed.
    expect(deriveWalletAddress(FACTORY, salt, PASSPHRASE)).toBe(
      'CCS4I77IIMPFP24PP67U2GWV5BXLLSTBJBK25Q347JLIBSCEMHIXLRLW',
    );
  });

  it('is deterministic and salt-sensitive', () => {
    expect(deriveWalletAddress(FACTORY, salt, PASSPHRASE)).toBe(
      deriveWalletAddress(FACTORY, salt, PASSPHRASE),
    );
    expect(deriveWalletAddress(FACTORY, Buffer.alloc(32, 8), PASSPHRASE)).not.toBe(
      deriveWalletAddress(FACTORY, salt, PASSPHRASE),
    );
  });
});
