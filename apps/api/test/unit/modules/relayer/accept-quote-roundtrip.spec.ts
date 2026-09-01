import { describe, it, expect } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { FakeRelayerService } from '../../../shared/fake-relayer';
import { decodeCoseToRawP256 } from '../../../../src/modules/wallets/cose.helper';
import { createSoftwarePasskey, signAssertion, type SoftwarePasskey } from '../../../shared/webauthn-authenticator';
import type { AcceptQuoteTuple } from '../../../../src/modules/relayer/relayer.service.interface';

/**
 * End-to-end round-trip of the two-signature accept_quote flow through `FakeRelayerService` (which drives the
 * REAL `verifySellerQuoteAuthEntry` + `verifyAcceptQuoteAuthorization`): seller authorize → buyer accept →
 * settle. Proves the challenge binding, the seller entry replay, and the total AcceptQuoteOutcome union work
 * offline. Positive + negative + the two failure outcomes.
 */
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const cid = (n: number) => StrKey.encodeContract(Buffer.concat([Buffer.alloc(31, 0), Buffer.from([n])]));

const tuple: AcceptQuoteTuple = {
  settlerContract: cid(1), usdcContract: cid(2), buyerWallet: cid(3), sellerWallet: cid(4),
  rfqId: new Uint8Array(32).fill(0x11), quoteId: new Uint8Array(32).fill(0x22), artworkId: new Uint8Array(32).fill(0x33),
  count: '500', gross: '10000',
};

function assertion(passkey: SoftwarePasskey, challenge: string, opts?: { origin?: string }) {
  const a = signAssertion({ passkey, challenge, rpId: RP_ID, origin: opts?.origin ?? ORIGIN });
  return {
    authenticatorData: new Uint8Array(Buffer.from(a.authenticatorData, 'base64url')),
    clientDataJSON: new Uint8Array(Buffer.from(a.clientDataJSON, 'base64url')),
    signature: new Uint8Array(Buffer.from(a.signature, 'base64url')),
  };
}

describe('accept_quote two-signature round-trip (fake relayer + real verifiers)', () => {
  async function authorizeSeller(relayer: FakeRelayerService, seller: SoftwarePasskey): Promise<string> {
    const built = await relayer.buildSellerQuoteAuth({ ...tuple, sigValidityLedgers: 34_000 });
    const attached = await relayer.attachSellerQuoteAuth({
      ...tuple, sellerAuthEntryXdr: built.sellerAuthEntryXdr,
      boundPublicKey: decodeCoseToRawP256(seller.cosePublicKey), credentialId: 'seller-cred',
      ...assertion(seller, built.challenge), rpId: RP_ID, allowedOrigins: [ORIGIN],
    });
    return attached.signedEntryXdr;
  }

  it('seller authorize → buyer accept → SUCCESS', async () => {
    const relayer = new FakeRelayerService();
    const seller = createSoftwarePasskey();
    const buyer = createSoftwarePasskey();
    const storedSellerEntryXdr = await authorizeSeller(relayer, seller);

    const prepared = await relayer.buildAcceptQuote({ ...tuple, sigValidityLedgers: 120 });
    const outcome = await relayer.submitSignedAcceptQuote({
      ...tuple, buyerAuthEntryXdr: prepared.buyerAuthEntryXdr, storedSellerEntryXdr,
      boundPublicKey: decodeCoseToRawP256(buyer.cosePublicKey), credentialId: 'buyer-cred',
      ...assertion(buyer, prepared.challenge), rpId: RP_ID, allowedOrigins: [ORIGIN],
    });
    expect(outcome.status).toBe('SUCCESS');
    if (outcome.status === 'SUCCESS') expect(outcome.txHash).toHaveLength(64);
  });

  it('a buyer assertion from the wrong key → RELAYER_FAILED (signature_invalid)', async () => {
    const relayer = new FakeRelayerService();
    const seller = createSoftwarePasskey();
    const buyer = createSoftwarePasskey();
    const storedSellerEntryXdr = await authorizeSeller(relayer, seller);
    const prepared = await relayer.buildAcceptQuote({ ...tuple, sigValidityLedgers: 120 });

    const outcome = await relayer.submitSignedAcceptQuote({
      ...tuple, buyerAuthEntryXdr: prepared.buyerAuthEntryXdr, storedSellerEntryXdr,
      boundPublicKey: decodeCoseToRawP256(createSoftwarePasskey().cosePublicKey), credentialId: 'buyer-cred',
      ...assertion(buyer, prepared.challenge), rpId: RP_ID, allowedOrigins: [ORIGIN],
    });
    expect(outcome).toEqual({ status: 'RELAYER_FAILED', reason: 'signature_invalid' });
  });

  it('a seller assertion from the wrong key is rejected at attach', async () => {
    const relayer = new FakeRelayerService();
    const built = await relayer.buildSellerQuoteAuth({ ...tuple, sigValidityLedgers: 34_000 });
    await expect(
      relayer.attachSellerQuoteAuth({
        ...tuple, sellerAuthEntryXdr: built.sellerAuthEntryXdr,
        boundPublicKey: decodeCoseToRawP256(createSoftwarePasskey().cosePublicKey), credentialId: 'seller-cred',
        ...assertion(createSoftwarePasskey(), built.challenge), rpId: RP_ID, allowedOrigins: [ORIGIN],
      }),
    ).rejects.toThrow(/signature verification failed/);
  });

  it('a contract revert surfaces as REVERTED{code} (seller-balance = #100)', async () => {
    const relayer = new FakeRelayerService();
    const seller = createSoftwarePasskey();
    const buyer = createSoftwarePasskey();
    const storedSellerEntryXdr = await authorizeSeller(relayer, seller);
    const prepared = await relayer.buildAcceptQuote({ ...tuple, sigValidityLedgers: 120 });
    relayer.revertNextAcceptSettle(100);
    const outcome = await relayer.submitSignedAcceptQuote({
      ...tuple, buyerAuthEntryXdr: prepared.buyerAuthEntryXdr, storedSellerEntryXdr,
      boundPublicKey: decodeCoseToRawP256(buyer.cosePublicKey), credentialId: 'buyer-cred',
      ...assertion(buyer, prepared.challenge), rpId: RP_ID, allowedOrigins: [ORIGIN],
    });
    expect(outcome).toEqual({ status: 'REVERTED', contractCode: 100 });
  });

  it('a relayer failure surfaces as RELAYER_FAILED', async () => {
    const relayer = new FakeRelayerService();
    relayer.failNextAcceptSubmit();
    const outcome = await relayer.submitSignedAcceptQuote({
      ...tuple, buyerAuthEntryXdr: '', storedSellerEntryXdr: '',
      boundPublicKey: new Uint8Array(65), credentialId: 'x',
      authenticatorData: new Uint8Array(37), clientDataJSON: new Uint8Array(1), signature: new Uint8Array(64),
      rpId: RP_ID, allowedOrigins: [ORIGIN],
    });
    expect(outcome).toEqual({ status: 'RELAYER_FAILED', reason: 'transfer_failed' });
  });
});
