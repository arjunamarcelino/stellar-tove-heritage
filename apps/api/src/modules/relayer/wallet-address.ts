import { Address, StrKey, xdr, hash } from '@stellar/stellar-sdk';

/**
 * Derive the deterministic Soroban wallet address off-chain: the contract-id preimage of
 * (deployer = the FACTORY contract, salt). Byte-identical to what the factory produces when it
 * deploys via `env.deployer().with_current_contract(salt)`. Pure (no network) so it is unit-testable
 * against a golden vector — this is the only CI check on the derivation, since matching the *real*
 * factory address requires the gated live-testnet test.
 */
export function deriveWalletAddress(
  factoryAddress: string,
  salt: Buffer,
  networkPassphrase: string,
): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(factoryAddress).toScAddress(),
          salt,
        }),
      ),
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}
