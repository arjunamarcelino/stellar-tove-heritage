import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- controllable @stellar/stellar-sdk mock --------------------------------
const mockSim = vi.fn();
let accountsBuilt = 0;

vi.mock('@stellar/stellar-sdk', () => {
  class Server {
    simulateTransaction = mockSim;
    constructor(public url: string) {}
  }
  class Contract {
    constructor(public addr: string) {}
    call(method: string) {
      return { token: this.addr, method };
    }
  }
  class TransactionBuilder {
    private op: unknown;
    addOperation(op: unknown) {
      this.op = op;
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { op: this.op };
    }
  }
  return {
    rpc: {
      Server,
      Api: {
        isSimulationSuccess: (s: { __ok?: boolean }) => Boolean(s?.__ok),
        isSimulationRestore: (s: { __restore?: boolean }) => Boolean(s?.__restore),
      },
    },
    Account: class {
      constructor(
        public id: string,
        public seq: string,
      ) {
        accountsBuilt++;
      }
    },
    Address: { fromString: (s: string) => ({ toScVal: () => ({ _addr: s }) }) },
    Contract,
    TransactionBuilder,
    BASE_FEE: '100',
    // Real retval is an xdr.ScVal object (always truthy, even for a 0 balance); decode extracts the value.
    scValToBigInt: (retval: { v: bigint }) => retval.v,
  };
});

const { SorobanFractionReadService } = await import(
  '../../../../src/modules/fractionalization/soroban-fraction-read.service'
);
const { FractionReadUnavailableError } = await import(
  '../../../../src/modules/fractionalization/fraction-read.errors'
);

const cfg = {
  rpcUrl: 'http://localhost:8000',
  networkPassphrase: 'Test SDF Network ; September 2015',
  sourcePublicKey: 'G'.repeat(56),
  concurrency: 8,
  timeoutMs: 5000,
  totalBudgetMs: 8000,
  fanOutWarnThreshold: 200,
  cacheTtlSeconds: 30,
};

function ok(retval: bigint) {
  return { __ok: true, result: { retval: { v: retval } } };
}

let service: InstanceType<typeof SorobanFractionReadService>;
beforeEach(() => {
  mockSim.mockReset();
  accountsBuilt = 0;
  service = new SorobanFractionReadService(cfg);
});

describe('SorobanFractionReadService.balancesOf', () => {
  it('returns an empty map (and makes no RPC call) for no tokens', async () => {
    const out = await service.balancesOf([], 'C'.repeat(56));
    expect(out.size).toBe(0);
    expect(mockSim).not.toHaveBeenCalled();
  });

  it('reads each token balance and decodes i128 → decimal string', async () => {
    const balances: Record<string, bigint> = { C1: 60n, C2: 0n, C3: 123456789012345678901234567890n };
    mockSim.mockImplementation((tx: { op: { token: string } }) => Promise.resolve(ok(balances[tx.op.token])));

    const out = await service.balancesOf(['C1', 'C2', 'C3'], 'C'.repeat(56));
    expect(out.get('C1')).toBe('60');
    expect(out.get('C2')).toBe('0'); // a genuine zero, never coerced from a failure
    expect(out.get('C3')).toBe('123456789012345678901234567890');
  });

  it('builds a fresh synthetic source Account per call (no shared-sequence race)', async () => {
    mockSim.mockImplementation(() => Promise.resolve(ok(1n)));
    await service.balancesOf(['C1', 'C2', 'C3'], 'C'.repeat(56));
    expect(accountsBuilt).toBe(3);
  });

  it('throws FractionReadUnavailableError when a simulation is not successful', async () => {
    mockSim.mockResolvedValue({ __ok: false, error: 'boom' });
    await expect(service.balancesOf(['C1'], 'C'.repeat(56))).rejects.toBeInstanceOf(
      FractionReadUnavailableError,
    );
  });

  it('throws when the retval is absent (never coerces to 0)', async () => {
    mockSim.mockResolvedValue({ __ok: true, result: { retval: undefined } });
    await expect(service.balancesOf(['C1'], 'C'.repeat(56))).rejects.toBeInstanceOf(
      FractionReadUnavailableError,
    );
  });

  it('throws (generic) when the RPC call itself rejects', async () => {
    mockSim.mockRejectedValue(new Error('ECONNRESET at 10.0.0.1'));
    await expect(service.balancesOf(['C1'], 'C'.repeat(56))).rejects.toMatchObject({
      name: 'FractionReadUnavailableError',
      message: 'balance read unavailable', // no RPC detail leaks into the message
    });
  });

  it('throws when the overall fan-out exceeds totalBudgetMs (slow-but-not-timing-out RPC)', async () => {
    // Reads never settle; per-call timeout (5000) would win, so a tiny budget must fire first.
    mockSim.mockImplementation(() => new Promise(() => {}));
    const slow = new SorobanFractionReadService({ ...cfg, totalBudgetMs: 20 });
    await expect(slow.balancesOf(['C1', 'C2'], 'C'.repeat(56))).rejects.toMatchObject({
      name: 'FractionReadUnavailableError',
      message: 'balance reads exceeded time budget',
    });
  });
});
