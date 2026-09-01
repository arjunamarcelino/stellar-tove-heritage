import { createHash } from 'node:crypto';
import { Address, StrKey, xdr, hash } from '@stellar/stellar-sdk';

/**
 * Derive the deterministic OfferingEscrow contract address off-chain: the contract-id preimage of
 * (deployer = the admin G-account source, salt). Byte-identical to what the network computes when
 * `Operation.createCustomContract({ address: <admin>, salt })` is applied — so the worker can pin the
 * address before submit and self-heal against it after a crash. Pure (no network) ⇒ golden-vector
 * unit-testable. Shape reused from `src/modules/relayer/wallet-address.ts`, parametrized on the
 * deployer address (here a G-account, not a factory contract).
 */
export function deriveOfferingEscrowAddress(
  deployerPubKey: string,
  salt: Buffer,
  networkPassphrase: string,
): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(deployerPubKey).toScAddress(),
          salt,
        }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}

/** Soroban salt = sha256(offering.id). Deterministic + collision-free (mirrors `token-init.ts`). */
export function escrowSalt(offeringId: string): Buffer {
  return createHash('sha256').update(offeringId, 'utf8').digest();
}
