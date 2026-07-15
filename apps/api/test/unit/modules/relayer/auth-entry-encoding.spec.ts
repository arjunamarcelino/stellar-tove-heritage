import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal, Address, Contract, Networks, StrKey } from '@stellar/stellar-sdk';
import {
  computeHostPayloadHash,
  computeAuthDigest,
  invocationsEqual,
  encodeAuthPayloadScVal,
  DEFAULT_CONTEXT_RULE_ID,
} from '../../../../src/modules/relayer/auth-entry-encoding';

const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const WALLET = 'CAZOVWDKGNPMSF7GJ3FKW7M7WGTQDUKDGC3VNVSN4TQYCXBHT53LHEZC';
const TO = 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI';

// Build a real `transfer` invocation's InvokeContractArgs.
function transferArgs(to: string, amount: bigint): xdr.InvokeContractArgs {
  const op = new Contract(USDC).call(
    'transfer',
    Address.fromString(WALLET).toScVal(),
    Address.fromString(to).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
  );
  return op.body().invokeHostFunctionOp().hostFunction().invokeContract();
}

function rootInvocation(args: xdr.InvokeContractArgs): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
    subInvocations: [],
  });
}

describe('auth-entry-encoding (OZ stellar-accounts v0.7.2 format)', () => {
  const nonce = xdr.Int64.fromString('123456789');
  const inv = rootInvocation(transferArgs(TO, 15000000n));

  it('computeHostPayloadHash is deterministic, 32 bytes, expiry-sensitive', () => {
    const a = computeHostPayloadHash(Networks.TESTNET, nonce, 1000, inv);
    const b = computeHostPayloadHash(Networks.TESTNET, nonce, 1000, inv);
    const c = computeHostPayloadHash(Networks.TESTNET, nonce, 1001, inv);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('computeAuthDigest = sha256(hostPayload ‖ xdr(context_rule_ids)), differs from host payload', () => {
    const host = computeHostPayloadHash(Networks.TESTNET, nonce, 1000, inv);
    const digest = computeAuthDigest(host, [DEFAULT_CONTEXT_RULE_ID]);
    expect(digest).toHaveLength(32);
    expect(digest.equals(host)).toBe(false);
    // deterministic + rule-id sensitive
    expect(computeAuthDigest(host, [0]).equals(digest)).toBe(true);
    expect(computeAuthDigest(host, [1]).equals(digest)).toBe(false);
  });

  it('invocationsEqual: equal args match, tampered recipient/amount differ', () => {
    expect(invocationsEqual(transferArgs(TO, 15000000n), transferArgs(TO, 15000000n))).toBe(true);
    expect(invocationsEqual(transferArgs(TO, 15000000n), transferArgs(TO, 99999999n))).toBe(false);
    expect(invocationsEqual(transferArgs(TO, 15000000n), transferArgs(WALLET, 15000000n))).toBe(false);
  });

  // Golden vector from the TOV-39 passing contract test (PR #22, golden_vector_passkey_authpayload).
  // The deployed wallet's real __check_auth accepts these exact AuthPayload bytes — if either side's
  // encoding drifts, this test (and their CI) goes red.
  it('encodeAuthPayloadScVal reproduces the TOV-39 golden AuthPayload byte-for-byte', () => {
    const pubkey = Buffer.from(
      '041f140146bfb1b251f84f4ddbe0d4cdcfd77afd984a9520e35794021f8312bb9eec995a08b1fa7704df3dcc0b50a9665263fb7711f95f9f8a449c5096e47c892b',
      'hex',
    );
    const credentialId = Buffer.alloc(16, 0xc4);
    const authenticatorData = Buffer.concat([Buffer.alloc(32, 0), Buffer.from([0x1d]), Buffer.alloc(4, 0)]);
    const clientDataJSON = Buffer.from(
      '{"type":"webauthn.get","challenge":"b2Tdn9KpP7Xqe1pgXCB9QQwV-XwbLowqWiW9kveVIRs","origin":"https://tove.example","crossOrigin":false}',
    );
    const signature = Buffer.from(
      '2348b434afac73923d0972d1e67ec097662621322b62652b2d7d9a5b1621cee972e4f2ded60f6d333ddb73a122c7f02883dd3673f3ee46d11d9d66e4addcb673',
      'hex',
    );
    const goldenAuthPayload =
      'AAAAEQAAAAEAAAACAAAADwAAABBjb250ZXh0X3J1bGVfaWRzAAAAEAAAAAEAAAABAAAAAwAAAAAAAAAPAAAAB3NpZ25lcnMAAAAAEQAAAAEAAAABAAAAEAAAAAEAAAADAAAADwAAAAhFeHRlcm5hbAAAABIAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAANAAAAUQQfFAFGv7GyUfhPTdvg1M3P13r9mEqVIONXlAIfgxK7nuyZWgix+ncE3z3MC1CpZlJj+3cR+V+fikScUJbkfIkrxMTExMTExMTExMTExMTExAAAAAAAAA0AAAFYAAAAEQAAAAEAAAADAAAADwAAABJhdXRoZW50aWNhdG9yX2RhdGEAAAAAAA0AAAAlAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdAAAAAAAAAAAAAA8AAAALY2xpZW50X2RhdGEAAAAADQAAAIV7InR5cGUiOiJ3ZWJhdXRobi5nZXQiLCJjaGFsbGVuZ2UiOiJiMlRkbjlLcFA3WHFlMXBnWENCOVFRd1YtWHdiTG93cVdpVzlrdmVWSVJzIiwib3JpZ2luIjoiaHR0cHM6Ly90b3ZlLmV4YW1wbGUiLCJjcm9zc09yaWdpbiI6ZmFsc2V9AAAAAAAADwAAAAlzaWduYXR1cmUAAAAAAAANAAAAQCNItDSvrHOSPQly0eZ+wJdmJiEyK2JlKy19mlsWIc7pcuTy3tYPbTM923OhIsfwKIPdNnPz7kbRHZ1m5K3ctnM=';

    const scVal = encodeAuthPayloadScVal({
      // Golden fixture's verifier contract id = 0x00..01 (31 zero bytes + 0x01).
      verifierAddress: StrKey.encodeContract(Buffer.concat([Buffer.alloc(31, 0), Buffer.from([0x01])])),
      keyData: Buffer.concat([pubkey, credentialId]),
      signature,
      authenticatorData,
      clientDataJSON,
      contextRuleIds: [DEFAULT_CONTEXT_RULE_ID],
    });

    expect(scVal.toXDR('base64')).toBe(goldenAuthPayload);
  });
});
