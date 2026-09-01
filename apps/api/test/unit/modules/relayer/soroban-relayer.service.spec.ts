import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { InMemoryRelayerAccountLock } from '../../../../src/modules/relayer/in-memory-relayer-account-lock';

// --- controllable @stellar/stellar-sdk mock --------------------------------
const mockGetAccount = vi.fn();
const mockSimulate = vi.fn();
const mockGetLatestLedger = vi.fn();
const mockSend = vi.fn();
const mockGetTx = vi.fn();
const mockGetLedgerEntries = vi.fn();
const mockAuthorizeEntry = vi.fn();
const contractCalls: { id: string; method: string; args: unknown[] }[] = [];

// A source-account credential entry — covered by the admin's envelope signature (admin-as-source).
const sourceEntry = () => ({
  credentials: () => ({ switch: () => ({ name: 'sorobanCredentialsSourceAccount' }) }),
});

vi.mock('@stellar/stellar-sdk', () => {
  class Server {
    getAccount = mockGetAccount;
    simulateTransaction = mockSimulate;
    getLatestLedger = mockGetLatestLedger;
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
      Api: {
        GetTransactionStatus: { NOT_FOUND: 'NOT_FOUND', SUCCESS: 'SUCCESS', FAILED: 'FAILED' },
        isSimulationError: (sim: { error?: unknown }) => Boolean(sim?.error),
      },
      // Assemble → a prepared tx exposing operations[0] + sign().
      assembleTransaction: () => ({
        build: () => ({ operations: [{}], sign: vi.fn() }),
      }),
    },
    // pubkey derived from the secret so admin-vs-source can be distinguished in tests.
    Keypair: {
      fromSecret: (s: string) => ({
        publicKey: () => (String(s).startsWith('SADMIN') ? 'GADMIN' : 'GRELAYER'),
        sign: () => undefined,
      }),
    },
    authorizeEntry: (entry: unknown, ...rest: unknown[]) => {
      mockAuthorizeEntry(entry, ...rest);
      return { _signed: true, entry };
    },
    Operation: {},
    Contract,
    Address: {
      fromString: (s: string) => ({ toScVal: () => scv('addr', s), toScAddress: () => ({ _sc: s }) }),
      fromScAddress: (v: { _g?: string }) => ({
        toBuffer: () => Buffer.alloc(32, 1),
        toString: () => v?._g ?? 'GUNKNOWN',
      }),
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
  // Admin == source by default (both derive 'GRELAYER'), so the base tests need no admin auth entry.
  factoryAdminSecret: 'S'.repeat(56),
  factoryAdminPublicKey: 'GRELAYER',
  probeOnBoot: false,
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
    mockSimulate.mockResolvedValue({ result: { auth: [] } }); // healthy sim, no auth entries
    mockGetLatestLedger.mockResolvedValue({ sequence: 1000 });
    mockSend.mockResolvedValue({ status: 'PENDING', hash: 'txhash-1' });
    mockGetTx.mockResolvedValue(successResp);
  });

  it('deploys via the factory: invokes deploy_wallet(3 args, no wasm_hash) and returns the C-address', async () => {
    const result = await makeSvc().deployPasskeyWallet(input);

    expect(result).toEqual({ contractAddress: 'CDEPLOYEDADDRESS', txHash: 'txhash-1' });
    expect(contractCalls).toHaveLength(1);
    expect(contractCalls[0].method).toBe('deploy_wallet');
    // The factory stores the wallet WASM hash internally; the call passes only salt, signers, policies.
    expect(contractCalls[0].args).toHaveLength(3);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('admin-as-source: sources from the factory-admin account and never uses authorizeEntry', async () => {
    // require_auth() is covered by the admin's envelope signature; a separately-signed ed25519 admin
    // entry is rejected on-chain (scecUnexpectedType), so authorizeEntry must never be called.
    mockSimulate.mockResolvedValue({ result: { auth: [sourceEntry()] } });
    const result = await makeSvc({ factoryAdminSecret: 'SADMIN' + 'S'.repeat(50) }).deployPasskeyWallet(
      input,
    );

    expect(result).toEqual({ contractAddress: 'CDEPLOYEDADDRESS', txHash: 'txhash-1' });
    expect(mockAuthorizeEntry).not.toHaveBeenCalled();
    // The lock/serialization is keyed on the admin account (its sequence), and getAccount reads it.
    expect(contractCalls[0].method).toBe('deploy_wallet');
  });

  it('throws when deploy_wallet simulation reverts (isSimulationError) and the wallet is absent', async () => {
    mockSimulate.mockResolvedValue({ error: 'Error(Contract, #7)' });
    await expect(makeSvc().deployPasskeyWallet(input)).rejects.toThrow(/simulation failed/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('existence check: skips the deploy when the wallet already exists (sequential self-heal)', async () => {
    mockGetLedgerEntries.mockResolvedValue({ entries: [{ present: true }] });
    const result = await makeSvc().deployPasskeyWallet(input);
    expect(result).toEqual({ contractAddress: 'CDEPLOYEDADDRESS', txHash: '' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(contractCalls).toHaveLength(0);
  });

  it('self-heals a simulate revert when the wallet now exists on-chain (re-check, not error text)', async () => {
    mockSimulate.mockRejectedValue(new Error('HostError: Error(Storage, ExistingValue)'));
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
