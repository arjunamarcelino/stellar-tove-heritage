import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryRelayerAccountLock } from '../../../../src/modules/relayer/in-memory-relayer-account-lock';

// --- controllable @stellar/stellar-sdk mock --------------------------------
const mockGetAccount = vi.fn();
const mockSim = vi.fn();
const mockSend = vi.fn();
const mockGetTx = vi.fn();
const contractCalls: { method: string; args: unknown[] }[] = [];

vi.mock('@stellar/stellar-sdk', () => {
  class Server {
    getAccount = mockGetAccount;
    simulateTransaction = mockSim;
    sendTransaction = mockSend;
    getTransaction = mockGetTx;
  }
  class Contract {
    call(method: string, ...args: unknown[]) {
      contractCalls.push({ method, args });
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
  return {
    rpc: {
      Server,
      Api: {
        isSimulationError: (s: { __err?: boolean }) => Boolean(s?.__err),
        GetTransactionStatus: { NOT_FOUND: 'NOT_FOUND', SUCCESS: 'SUCCESS', FAILED: 'FAILED' },
      },
      assembleTransaction: () => ({ build: () => ({ sign: vi.fn(), hash: () => Buffer.from('ab', 'hex') }) }),
    },
    Keypair: { fromSecret: () => ({ publicKey: () => 'GADMIN', sign: () => undefined }) },
    Account: class {
      constructor(
        public id: string,
        public seq: string,
      ) {}
    },
    Contract,
    Address: { fromString: (s: string) => ({ toScVal: () => ({ _addr: s }) }) },
    // Both predicates are stubbed so the widened guard (isValidContract || isValidEd25519PublicKey, TOV-243)
    // is exercised as-is; the C-address fixture makes isValidContract the deciding term.
    StrKey: { isValidContract: () => true, isValidEd25519PublicKey: () => false },
    TransactionBuilder,
    BASE_FEE: '100',
  };
});

const { SorobanKycAllowlistService } = await import(
  '../../../../src/modules/kyc-allowlist/soroban-kyc-allowlist.service'
);
const { KycAllowlistThrottledError } = await import(
  '../../../../src/modules/kyc-allowlist/kyc-allowlist.errors'
);

const cfg = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractAddress: 'C'.repeat(56),
  adminPublicKey: 'GADMIN',
  submitTimeoutMs: 15000,
  maxBatch: 5,
  probeOnBoot: false,
  adminSecret: 'S'.repeat(56),
};
const WALLET = 'C'.repeat(56);
const makeSvc = (over: Partial<typeof cfg> = {}) =>
  new SorobanKycAllowlistService({ ...cfg, ...over }, new InMemoryRelayerAccountLock());

const boolSim = (v: boolean) => ({
  __err: false,
  result: { retval: { switch: () => ({ name: 'scvBool' }), b: () => v } },
});

describe('SorobanKycAllowlistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contractCalls.length = 0;
    mockGetAccount.mockResolvedValue({ accountId: () => 'GADMIN' });
    mockSend.mockResolvedValue({ status: 'PENDING', hash: 'txhash-1' });
    mockGetTx.mockResolvedValue({ status: 'SUCCESS', ledger: 55 });
  });

  // --- isAllowed (read) ---
  it.each([
    [true],
    [false],
  ])('isAllowed parses the scvBool return: %s', async (v) => {
    mockSim.mockResolvedValue(boolSim(v));
    await expect(makeSvc().isAllowed(WALLET)).resolves.toBe(v);
    expect(contractCalls[0].method).toBe('is_allowed');
    expect(mockGetAccount).not.toHaveBeenCalled(); // read simulates against a synthetic account (todo 233)
  });

  it('isAllowed throws throttled when the simulation is an error', async () => {
    mockSim.mockResolvedValue({ __err: true });
    await expect(makeSvc().isAllowed(WALLET)).rejects.toBeInstanceOf(KycAllowlistThrottledError);
  });

  // --- submitOne (write) ---
  it('submitOne confirms: simulate → send → poll SUCCESS returns confirmed with the ledger', async () => {
    mockSim.mockResolvedValue({ __err: false });
    const res = await makeSvc().submitOne('add', WALLET);
    expect(res).toEqual({ status: 'confirmed', txHash: 'txhash-1', ledger: 55 });
    expect(contractCalls[0].method).toBe('add');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('submitOne lowercases the tx hash before returning (DB CHECK is [0-9a-f]) — todo 230', async () => {
    mockSim.mockResolvedValue({ __err: false });
    mockSend.mockResolvedValue({ status: 'PENDING', hash: 'ABCDEF1234ABCDEF1234ABCDEF1234ABCDEF1234ABCDEF1234ABCDEF1234ABCD' });
    const res = await makeSvc().submitOne('add', WALLET);
    expect(res.txHash).toBe('abcdef1234abcdef1234abcdef1234abcdef1234abcdef1234abcdef1234abcd');
  });

  it('submitOne returns pending when the poll times out still NOT_FOUND', async () => {
    mockSim.mockResolvedValue({ __err: false });
    mockGetTx.mockResolvedValue({ status: 'NOT_FOUND' });
    const res = await makeSvc({ submitTimeoutMs: 0 }).submitOne('remove', WALLET);
    expect(res).toEqual({ status: 'pending', txHash: 'txhash-1' });
  });

  it('submitOne throws throttled on TRY_AGAIN_LATER', async () => {
    mockSim.mockResolvedValue({ __err: false });
    mockSend.mockResolvedValue({ status: 'TRY_AGAIN_LATER' });
    await expect(makeSvc().submitOne('add', WALLET)).rejects.toBeInstanceOf(KycAllowlistThrottledError);
  });

  it('submitOne throws when send is rejected', async () => {
    mockSim.mockResolvedValue({ __err: false });
    mockSend.mockResolvedValue({ status: 'ERROR' });
    await expect(makeSvc().submitOne('add', WALLET)).rejects.toThrow(/rejected/);
  });

  it('submitOne throws when the simulation fails', async () => {
    mockSim.mockResolvedValue({ __err: true, error: 'boom' });
    await expect(makeSvc().submitOne('add', WALLET)).rejects.toThrow(/simulation failed/);
  });

  it('submitOne throws when the tx is included but reverts (FAILED at apply)', async () => {
    mockSim.mockResolvedValue({ __err: false });
    mockGetTx.mockResolvedValue({ status: 'FAILED' });
    await expect(makeSvc().submitOne('add', WALLET)).rejects.toThrow(/did not succeed/);
  });
});
