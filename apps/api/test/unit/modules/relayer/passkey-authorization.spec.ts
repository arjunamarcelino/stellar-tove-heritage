import { describe, it, expect } from 'vitest';
import {
  xdr,
  Address,
  Contract,
  nativeToScVal,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  Account,
  Operation,
  StrKey,
  Keypair,
} from '@stellar/stellar-sdk';
import { verifyPasskeyAuthorization } from '../../../../src/modules/relayer/passkey-authorization';
import {
  computeHostPayloadHash,
  computeAuthDigest,
} from '../../../../src/modules/relayer/auth-entry-encoding';
import { RelayerTransferError } from '../../../../src/modules/relayer/relayer.errors';
import { decodeCoseToRawP256 } from '../../../../src/modules/wallets/cose.helper';
import { createSoftwarePasskey, signAssertion } from '../../../shared/webauthn-authenticator';

const NET = Networks.TESTNET;
const RP_ID = 'tove.io';
const ORIGIN = 'https://tove.io';
const contractId = (n: number) => StrKey.encodeContract(Buffer.concat([Buffer.alloc(31, 0), Buffer.from([n])]));
const WALLET = contractId(9);
const USDC = contractId(7);
const TO = contractId(5);
const b64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

// Build a transfer tx with an address-cred auth entry (as buildTransfer would, minus a live simulate).
function buildTx(opts?: {
  amount?: bigint;
  authAmount?: bigint;
  from?: string;
  nonce?: string;
  expLedger?: number;
  opFunc?: xdr.HostFunction; // override the operation's host function (auth entry stays the transfer)
  amountScVal?: xdr.ScVal; // override the amount ScVal in BOTH op + auth entry (binding still holds)
}) {
  const amount = opts?.amount ?? 15000000n;
  const authAmount = opts?.authAmount ?? amount;
  const from = opts?.from ?? WALLET;
  const nonce = xdr.Int64.fromString(opts?.nonce ?? '777');
  const expLedger = opts?.expLedger ?? 12345;

  const invocation = (amt: bigint) =>
    new Contract(USDC)
      .call(
        'transfer',
        Address.fromString(from).toScVal(),
        Address.fromString(TO).toScVal(),
        opts?.amountScVal ?? nativeToScVal(amt, { type: 'i128' }),
      )
      .body()
      .invokeHostFunctionOp()
      .hostFunction();

  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invocation(authAmount).invokeContract()),
    subInvocations: [],
  });
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: Address.fromString(WALLET).toScAddress(),
      nonce,
      signatureExpirationLedger: expLedger,
      signature: xdr.ScVal.scvVoid(),
    }),
  );
  const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
  const op = Operation.invokeHostFunction({ func: opts?.opFunc ?? invocation(amount), auth: [entry] });
  const account = new Account(Keypair.random().publicKey(), '1');
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NET }).addOperation(op).setTimeout(30).build();

  const hostPayload = computeHostPayloadHash(NET, nonce, expLedger, rootInvocation);
  const challenge = computeAuthDigest(hostPayload, [0]).toString('base64url');
  return { txXdr: tx.toXDR(), challenge };
}

describe('verifyPasskeyAuthorization', () => {
  const passkey = createSoftwarePasskey();
  const boundKey = decodeCoseToRawP256(passkey.cosePublicKey);

  const base = (txXdr: string, assertion: { authenticatorData: string; clientDataJSON: string; signature: string }) => ({
    txXdr,
    networkPassphrase: NET,
    walletContract: WALLET,
    tokenContract: USDC,
    contextRuleIds: [0],
    boundPublicKey: boundKey,
    authenticatorData: b64u(assertion.authenticatorData),
    clientDataJSON: b64u(assertion.clientDataJSON),
    signatureDer: b64u(assertion.signature),
    rpId: RP_ID,
    allowedOrigins: [ORIGIN],
    maxTransferAmount: '1000000000000',
  });

  it('accepts a valid assertion and returns the low-S 64-byte signature', () => {
    const { txXdr, challenge } = buildTx();
    const assertion = signAssertion({ passkey, challenge, rpId: RP_ID, origin: ORIGIN });
    const result = verifyPasskeyAuthorization(base(txXdr, assertion));
    expect(result.signatureCompact.length).toBe(64);
    expect(result.signatureExpirationLedger).toBe(12345);
  });

  it('refuses a missing signature with signature_required', () => {
    const { txXdr, challenge } = buildTx();
    const assertion = signAssertion({ passkey, challenge, rpId: RP_ID, origin: ORIGIN });
    const input = { ...base(txXdr, assertion), signatureDer: new Uint8Array() };
    expect(() => verifyPasskeyAuthorization(input)).toThrow(
      expect.objectContaining({ reason: 'signature_required' }) as RelayerTransferError,
    );
  });

  it('refuses a signature from a different key', () => {
    const { txXdr, challenge } = buildTx();
    const assertion = signAssertion({ passkey, challenge, rpId: RP_ID, origin: ORIGIN });
    const other = decodeCoseToRawP256(createSoftwarePasskey().cosePublicKey);
    expect(() => verifyPasskeyAuthorization({ ...base(txXdr, assertion), boundPublicKey: other })).toThrow(
      /signature verification failed/,
    );
  });

  it('refuses a tampered operation (op amount != authorized amount) — the BLOCKER binding', () => {
    // The signed auth entry authorizes 15000000 but the executed operation moves 99999999.
    const { txXdr, challenge } = buildTx({ amount: 99999999n, authAmount: 15000000n });
    const assertion = signAssertion({ passkey, challenge, rpId: RP_ID, origin: ORIGIN });
    expect(() => verifyPasskeyAuthorization(base(txXdr, assertion))).toThrow(
      /does not match the authorized invocation/,
    );
  });

  it('refuses when `from` is not the caller wallet', () => {
    const { txXdr, challenge } = buildTx({ from: TO }); // from = someone else, entry addr still WALLET
    const assertion = signAssertion({ passkey, challenge, rpId: RP_ID, origin: ORIGIN });
    expect(() => verifyPasskeyAuthorization(base(txXdr, assertion))).toThrow(RelayerTransferError);
  });

  it('refuses a challenge that does not bind to this transfer', () => {
    const { txXdr } = buildTx();
    const assertion = signAssertion({ passkey, challenge: 'not-the-real-challenge', rpId: RP_ID, origin: ORIGIN });
    expect(() => verifyPasskeyAuthorization(base(txXdr, assertion))).toThrow(/challenge does not bind/);
  });

  it('refuses when the user-verification flag is clear', () => {
    const { txXdr, challenge } = buildTx();
    const assertion = signAssertion({ passkey, challenge, rpId: RP_ID, origin: ORIGIN, flags: 0x01 }); // UP only
    expect(() => verifyPasskeyAuthorization(base(txXdr, assertion))).toThrow(/user-verification/);
  });

  it('refuses an off-allowlist origin', () => {
    const { txXdr, challenge } = buildTx();
    const assertion = signAssertion({ passkey, challenge, rpId: RP_ID, origin: 'https://evil.example' });
    expect(() => verifyPasskeyAuthorization(base(txXdr, assertion))).toThrow(/origin/);
  });

  it('refuses a self-built tx whose amount exceeds the ceiling (bypass guard)', () => {
    const { txXdr, challenge } = buildTx({ amount: 20000000000000n, authAmount: 20000000000000n });
    const assertion = signAssertion({ passkey, challenge, rpId: RP_ID, origin: ORIGIN });
    // Valid signature + binding, but the amount is over the ceiling — still refused.
    expect(() => verifyPasskeyAuthorization({ ...base(txXdr, assertion), maxTransferAmount: '1000000000000' })).toThrow(
      /amount exceeds the maximum/,
    );
  });

  it('refuses an invokeHostFunction op whose host function is not invokeContract (108)', () => {
    // A crafted op with an upload-wasm host function must be a clean refusal, not a raw throw from
    // the union accessor escaping the fail-closed contract.
    const opFunc = xdr.HostFunction.hostFunctionTypeUploadContractWasm(Buffer.from([1, 2, 3]));
    const { txXdr, challenge } = buildTx({ opFunc });
    const assertion = signAssertion({ passkey, challenge, rpId: RP_ID, origin: ORIGIN });
    expect(() => verifyPasskeyAuthorization(base(txXdr, assertion))).toThrow(RelayerTransferError);
    expect(() => verifyPasskeyAuthorization(base(txXdr, assertion))).toThrow(/host function is not a contract invocation/);
  });

  it('refuses a transfer whose amount arg is not an i128 — no raw TypeError on the ceiling check (109)', () => {
    // A non-i128 amount ScVal (bound identically in op + auth entry) must be a clean refusal, not a
    // `TypeError: Cannot mix BigInt` from the unchecked `as bigint` cast escaping as a 503.
    const { txXdr, challenge } = buildTx({ amountScVal: xdr.ScVal.scvSymbol('notanumber') });
    const assertion = signAssertion({ passkey, challenge, rpId: RP_ID, origin: ORIGIN });
    expect(() => verifyPasskeyAuthorization(base(txXdr, assertion))).toThrow(RelayerTransferError);
    expect(() => verifyPasskeyAuthorization(base(txXdr, assertion))).toThrow(/amount is not an i128/);
  });
});
