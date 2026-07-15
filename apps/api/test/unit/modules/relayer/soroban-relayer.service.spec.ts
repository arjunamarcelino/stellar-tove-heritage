import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { InMemoryRelayerAccountLock } from '../../../../src/modules/relayer/in-memory-relayer-account-lock';

// --- controllable @stellar/stellar-sdk mock --------------------------------
const mockGetAccount = vi.fn();
const mockPrepare = vi.fn();
const mockSend = vi.fn();
const mockGetTx = vi.fn();
const mockGetLedgerEntries = vi.fn();
const contractCalls: { id: string; method: string; args: unknown[] }[] = [];

vi.mock('@stellar/stellar-sdk', () => {
  class Server {
    getAccount = mockGetAccount;
    prepareTransaction = mockPrepare;
    sendTransaction = mockSend;
    getTransaction = mockGetTx;
    getLedgerEntries = mockGetLedgerEntries;
  }
  class Contract {
    constructor(private id: string) {}
    call(method: string, ...args: unknown[]) {
      contractCalls.push({ id: this.id, method, args });
      return { op: true };
    }
  }
  class TransactionBuilder {
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { built: true };
    }
  }
  const scv = (t: string, v: unknown) => ({ _t: t, v });
  return {
    rpc: {
      Server,
      Api: { GetTransactionStatus: { NOT_FOUND: 'NOT_FOUND', SUCCESS: 'SUCCESS', FAILED: 'FAILED' } },
    },
    Keypair: { fromSecret: () => ({ publicKey: () => 'GRELAYER', sign: () => undefined }) },
    Contract,
    Address: {
      fromString: (s: string) => ({ toScVal: () => scv('addr', s), toScAddress: () => ({ _sc: s }) }),
      fromScAddress: () => ({ toBuffer: () => Buffer.alloc(32, 1) }),
    },
    TransactionBuilder,
    StrKey: { encodeContract: () => 'CDEPLOYEDADDRESS' },
    hash: (b: Buffer) => createHash('sha256').update(b).digest(),
    xdr: {
      ScVal: {
        scvBytes: (b: Buffer) => scv('bytes', Buffer.from(b)),
        scvSymbol: (s: string) => scv('sym', s),
        scvVec: (a: unknown[]) => scv('vec', a),
        scvMap: (m: unknown[]) => scv('map', m),
        scvLedgerKeyContractInstance: () => scv('instanceKey', null),
      },
      ScValType: { scvAddress: () => 'SCV_ADDRESS' },
      HashIdPreimage: { envelopeTypeContractId: () => ({ toXDR: () => Buffer.from('preimage') }) },
      HashIdPreimageContractId: class {},
      ContractIdPreimage: { contractIdPreimageFromAddress: (v: unknown) => v },
      ContractIdPreimageFromAddress: class {},
      LedgerKey: { contractData: (v: unknown) => v },
      LedgerKeyContractData: class {},
      ContractDataDurability: { persistent: () => 'persistent' },
    },
    BASE_FEE: '100',
  };
});

const { SorobanRelayerService } = await import(
  '../../../../src/modules/relayer/soroban-relayer.service'
);

const cfg = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  relayerSecret: 'S'.repeat(56),
  walletWasmHash: 'ab'.repeat(32),
  factoryAddress: 'C'.repeat(56),
  webauthnVerifierAddress: 'C'.repeat(56),
  ed25519VerifierAddress: '',
  deployTimeoutMs: 20000,
};

const makeSvc = (over: Partial<typeof cfg> = {}) =>
  new SorobanRelayerService({ ...cfg, ...over }, new InMemoryRelayerAccountLock());

const secp256r1PublicKey = new Uint8Array(65).fill(9);
secp256r1PublicKey[0] = 0x04;
const input = { credentialId: 'cred-xyz', secp256r1PublicKey };
const successResp = {
  status: 'SUCCESS',
  returnValue: { switch: () => 'SCV_ADDRESS', address: () => ({}) },
};

describe('SorobanRelayerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contractCalls.length = 0;
    vi.spyOn(SorobanRelayerService.prototype as unknown as { sleep: () => Promise<void> }, 'sleep')
      .mockResolvedValue(undefined);
    mockGetLedgerEntries.mockResolvedValue({ entries: [] }); // wallet does not exist yet
    mockGetAccount.mockResolvedValue({ accountId: () => 'GRELAYER' });
    mockPrepare.mockResolvedValue({ sign: vi.fn() });
    mockSend.mockResolvedValue({ status: 'PENDING', hash: 'txhash-1' });
    mockGetTx.mockResolvedValue(successResp);
  });

  it('deploys via the factory: invokes deploy_wallet(4 args) and returns the C-address', async () => {
    const result = await makeSvc().deployPasskeyWallet(input);

    expect(result).toEqual({ contractAddress: 'CDEPLOYEDADDRESS', txHash: 'txhash-1' });
    expect(contractCalls).toHaveLength(1);
    expect(contractCalls[0].method).toBe('deploy_wallet');
    expect(contractCalls[0].args).toHaveLength(4); // wasm_hash, salt, signers, policies
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('existence check: skips the deploy when the wallet already exists (sequential self-heal)', async () => {
    mockGetLedgerEntries.mockResolvedValue({ entries: [{ present: true }] });
    const result = await makeSvc().deployPasskeyWallet(input);
    expect(result).toEqual({ contractAddress: 'CDEPLOYEDADDRESS', txHash: '' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(contractCalls).toHaveLength(0);
  });

  it('self-heals a prepare/simulate revert when the wallet now exists on-chain (re-check, not error text)', async () => {
    mockPrepare.mockRejectedValue(new Error('HostError: Error(Storage, ExistingValue)'));
    mockGetLedgerEntries
      .mockResolvedValueOnce({ entries: [] }) // initial existence check → proceed to deploy
      .mockResolvedValue({ entries: [{ present: true }] }); // re-check after failure → self-heal
    const result = await makeSvc().deployPasskeyWallet(input);
    expect(result).toEqual({ contractAddress: 'CDEPLOYEDADDRESS', txHash: '' });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('self-heals a send/poll collision via the on-chain re-check even with an opaque (XDR) error', async () => {
    // errorResult is an unparseable XDR-shaped object — the old regex-over-base64 could never match;
    // the fix relies on walletExists(derived), so this now self-heals.
    mockSend.mockResolvedValue({ status: 'ERROR', errorResult: { toXDR: () => 'base64blob' } });
    mockGetLedgerEntries
      .mockResolvedValueOnce({ entries: [] })
      .mockResolvedValue({ entries: [{ present: true }] });
    const result = await makeSvc().deployPasskeyWallet(input);
    expect(result).toEqual({ contractAddress: 'CDEPLOYEDADDRESS', txHash: '' });
  });

  it('throws on a send ERROR when the wallet is absent on re-check (genuine failure)', async () => {
    mockSend.mockResolvedValue({ status: 'ERROR', errorResult: { toXDR: () => 'base64blob' } });
    // getLedgerEntries stays [] for both the initial check and the re-check → not a collision.
    await expect(makeSvc().deployPasskeyWallet(input)).rejects.toThrow(/rejected the deploy/);
  });

  it('throws when the transaction FAILED and the wallet is absent on re-check', async () => {
    mockGetTx.mockResolvedValue({ status: 'FAILED' });
    await expect(makeSvc().deployPasskeyWallet(input)).rejects.toThrow(/transaction failed/);
  });

  const badSeqResult = { result: () => ({ switch: () => ({ name: 'txBadSeq' }) }) };

  it('retries transparently on a stale-sequence (txBAD_SEQ) collision, then succeeds', async () => {
    mockSend
      .mockResolvedValueOnce({ status: 'ERROR', errorResult: badSeqResult }) // 1st: stale sequence
      .mockResolvedValue({ status: 'PENDING', hash: 'txhash-2' }); // retry: succeeds
    // wallet never exists on-chain (the BAD_SEQ tx failed) → not a self-heal, a genuine retry.
    const result = await makeSvc().deployPasskeyWallet(input);
    expect(result).toEqual({ contractAddress: 'CDEPLOYEDADDRESS', txHash: 'txhash-2' });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('gives up after MAX_DEPLOY_RETRIES persistent stale-sequence failures', async () => {
    mockSend.mockResolvedValue({ status: 'ERROR', errorResult: badSeqResult });
    await expect(makeSvc().deployPasskeyWallet(input)).rejects.toThrow(/sequence/);
    expect(mockSend).toHaveBeenCalledTimes(4); // initial + MAX_DEPLOY_RETRIES (3)
  });

  it('polls the hash on a DUPLICATE send status (identical tx already submitted)', async () => {
    mockSend.mockResolvedValue({ status: 'DUPLICATE', hash: 'txhash-dup' });
    const result = await makeSvc().deployPasskeyWallet(input);
    expect(result).toEqual({ contractAddress: 'CDEPLOYEDADDRESS', txHash: 'txhash-dup' });
  });

  it('retries a throttled (TRY_AGAIN_LATER) send at the outer loop, then succeeds', async () => {
    mockSend
      .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER' }) // throttled
      .mockResolvedValue({ status: 'PENDING', hash: 'txhash-3' }); // retry succeeds
    const result = await makeSvc().deployPasskeyWallet(input);
    expect(result).toEqual({ contractAddress: 'CDEPLOYEDADDRESS', txHash: 'txhash-3' });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('times out a hung RPC call so it cannot exceed the lock TTL', async () => {
    vi.useFakeTimers();
    try {
      mockGetAccount.mockReturnValue(new Promise(() => {})); // never resolves
      const p = makeSvc().deployPasskeyWallet(input);
      const assertion = expect(p).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(6000); // > RPC_TIMEOUT_MS
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out at the deadline while still NOT_FOUND', async () => {
    mockGetTx.mockResolvedValue({ status: 'NOT_FOUND' });
    await expect(makeSvc({ deployTimeoutMs: 0 }).deployPasskeyWallet(input)).rejects.toThrow(/timed out/);
  });

  it('guards the ScVal discriminant: a non-address return value throws', async () => {
    mockGetTx.mockResolvedValue({ status: 'SUCCESS', returnValue: { switch: () => 'SCV_OTHER' } });
    await expect(makeSvc().deployPasskeyWallet(input)).rejects.toThrow(/not a contract address/);
  });

  it('serializes concurrent deploys (no overlapping getAccount / sequence collision)', async () => {
    let active = 0;
    let maxActive = 0;
    mockGetAccount.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { accountId: () => 'GRELAYER' };
    });
    const svc = makeSvc();
    await Promise.all([
      svc.deployPasskeyWallet({ ...input, credentialId: 'a' }),
      svc.deployPasskeyWallet({ ...input, credentialId: 'b' }),
    ]);
    expect(maxActive).toBe(1);
  });
});
