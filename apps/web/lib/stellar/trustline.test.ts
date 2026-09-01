import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked SDK: the engine dynamically imports '@stellar/stellar-sdk', so vi.mock intercepts it. We stub
// only the surface the engine touches. TransactionFailedError/NotFoundError must be the SAME classes the
// engine sees (for its instanceof / name checks), so they live in vi.hoisted and are re-exported here.
const h = vi.hoisted(() => {
  class TransactionFailedError extends Error {
    codes: { transaction?: string; operations?: string[] };
    constructor(codes: { transaction?: string; operations?: string[] }) {
      super('tx failed');
      this.name = 'TransactionFailedError';
      this.codes = codes;
    }
    getResultCodes() {
      return this.codes;
    }
  }
  class NotFoundError extends Error {
    response = { status: 404 };
    constructor() {
      super('not found');
      this.name = 'NotFoundError';
    }
  }
  return {
    loadAccount: vi.fn(),
    submitTransaction: vi.fn(),
    transactionCall: vi.fn(),
    fromXDR: vi.fn(),
    TransactionFailedError,
    NotFoundError,
  };
});

vi.mock('@stellar/stellar-sdk', () => {
  class Server {
    constructor(public url: string) {}
    loadAccount(id: string) {
      return h.loadAccount(id);
    }
    submitTransaction(tx: unknown) {
      return h.submitTransaction(tx);
    }
    transactions() {
      return { transaction: (hash: string) => ({ call: () => h.transactionCall(hash) }) };
    }
  }
  class Account {
    constructor(
      public id: string,
      public seq: string,
    ) {}
    sequenceNumber() {
      return this.seq;
    }
  }
  class Asset {
    constructor(
      public code: string,
      public issuer: string,
    ) {}
  }
  const Operation = { changeTrust: (o: unknown) => ({ type: 'changeTrust', o }) };
  class TransactionBuilder {
    ops: unknown[] = [];
    constructor(
      public source: unknown,
      public opts: unknown,
    ) {}
    addOperation(op: unknown) {
      this.ops.push(op);
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { toXDR: () => 'BUILT_XDR', hash: () => new Uint8Array([0xde, 0xad, 0xbe, 0xef]) };
    }
    static fromXDR(xdr: string) {
      return h.fromXDR(xdr);
    }
  }
  return {
    Horizon: { Server },
    Account,
    Asset,
    Operation,
    TransactionBuilder,
    BASE_FEE: '100',
    TransactionFailedError: h.TransactionFailedError,
    NotFoundError: h.NotFoundError,
  };
});

import {
  xlmToStroops,
  stroopsToXlm,
  trustlineReserveShortfall,
  loadAccountState,
  buildChangeTrustXdr,
  submitSignedTransaction,
  pollTransaction,
} from '@/lib/stellar/trustline';

const USDC = {
  code: 'USDC',
  issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.fromXDR.mockReturnValue({ hash: () => new Uint8Array([0xde, 0xad, 0xbe, 0xef]) });
});

describe('reserve math', () => {
  it('xlmToStroops / stroopsToXlm round-trip and pad correctly', () => {
    expect(xlmToStroops('1')).toBe(10_000_000n);
    expect(xlmToStroops('0.5')).toBe(5_000_000n);
    expect(xlmToStroops('5.0000001')).toBe(50_000_001n);
    expect(stroopsToXlm(5_000_000n)).toBe('0.5');
    expect(stroopsToXlm(10_000_000n)).toBe('1');
    expect(stroopsToXlm(50_000_001n)).toBe('5.0000001');
  });

  it('no shortfall when the account comfortably covers the new subentry', () => {
    // bare account (0 subentries) needs 1 XLM; +1 trustline → 1.5 XLM + fee. 5 XLM is plenty.
    expect(
      trustlineReserveShortfall({ nativeBalance: '5', subentryCount: 0, sellingLiabilities: '0' }),
    ).toBe(0n);
  });

  it('reports the exact shortfall when below the post-trustline minimum', () => {
    // 0 subentries: minAfter = 3 × 0.5 = 1.5 XLM (+100 stroops fee). Balance 1.0 → short 0.5 XLM + fee.
    const short = trustlineReserveShortfall({
      nativeBalance: '1',
      subentryCount: 0,
      sellingLiabilities: '0',
    });
    expect(short).toBe(5_000_100n); // 0.5 XLM + 100 stroops
  });

  it('subtracts selling liabilities from the available balance', () => {
    const short = trustlineReserveShortfall({
      nativeBalance: '2',
      subentryCount: 0,
      sellingLiabilities: '1',
    });
    // available = 2 − 1 = 1 XLM; required 1.5 XLM + fee → short 0.5 XLM + fee.
    expect(short).toBe(5_000_100n);
  });
});

describe('loadAccountState', () => {
  it('returns funded with usdcLine "active" when the account trusts USDC', async () => {
    h.loadAccount.mockResolvedValue({
      sequenceNumber: () => '100',
      subentry_count: 1,
      balances: [
        { asset_type: 'native', balance: '5.0000000', selling_liabilities: '0.0000000' },
        {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: USDC.issuer,
          balance: '0',
          is_authorized: true,
        },
      ],
    });
    const state = await loadAccountState(
      'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
      USDC,
    );
    expect(state).toEqual({
      status: 'funded',
      sequence: '100',
      subentryCount: 1,
      nativeBalance: '5.0000000',
      sellingLiabilities: '0.0000000',
      usdcLine: 'active',
    });
  });

  it('returns funded with usdcLine "missing" when no USDC line', async () => {
    h.loadAccount.mockResolvedValue({
      sequenceNumber: () => '100',
      subentry_count: 0,
      balances: [{ asset_type: 'native', balance: '5' }],
    });
    const state = await loadAccountState(
      'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
      USDC,
    );
    expect(state.status).toBe('funded');
    if (state.status === 'funded') expect(state.usdcLine).toBe('missing');
  });

  it('returns unfunded on a Horizon 404 (NotFoundError)', async () => {
    h.loadAccount.mockRejectedValue(new h.NotFoundError());
    expect(
      await loadAccountState('GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O', USDC),
    ).toEqual({ status: 'unfunded' });
  });

  it('fails open to horizonUnavailable on any other error', async () => {
    h.loadAccount.mockRejectedValue(new Error('boom'));
    expect(
      await loadAccountState('GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O', USDC),
    ).toEqual({ status: 'horizonUnavailable' });
  });

  it('fails closed to horizonUnavailable on a malformed address (never hits Horizon)', async () => {
    expect(await loadAccountState('not-a-strkey', USDC)).toEqual({ status: 'horizonUnavailable' });
    expect(h.loadAccount).not.toHaveBeenCalled();
  });
});

describe('buildChangeTrustXdr', () => {
  it('builds a change_trust envelope and returns its XDR', async () => {
    const xdr = await buildChangeTrustXdr({
      accountId: 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O',
      sequence: '100',
      asset: USDC,
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    expect(xdr).toBe('BUILT_XDR');
  });
});

describe('submitSignedTransaction', () => {
  it('confirmed when Horizon reports successful', async () => {
    h.submitTransaction.mockResolvedValue({ successful: true, hash: 'HASH123' });
    expect(await submitSignedTransaction('SIGNED', 'pass')).toEqual({
      kind: 'confirmed',
      hash: 'HASH123',
    });
  });

  it('rebuild on tx_bad_seq', async () => {
    h.submitTransaction.mockRejectedValue(
      new h.TransactionFailedError({ transaction: 'tx_bad_seq', operations: [] }),
    );
    expect(await submitSignedTransaction('SIGNED', 'pass')).toEqual({
      kind: 'rebuild',
      cause: 'tx_bad_seq',
    });
  });

  it('rebuild on tx_too_late', async () => {
    h.submitTransaction.mockRejectedValue(
      new h.TransactionFailedError({ transaction: 'tx_too_late', operations: [] }),
    );
    expect(await submitSignedTransaction('SIGNED', 'pass')).toEqual({
      kind: 'rebuild',
      cause: 'tx_too_late',
    });
  });

  it('accountMismatch on tx_bad_auth (signed by a different active account)', async () => {
    h.submitTransaction.mockRejectedValue(
      new h.TransactionFailedError({ transaction: 'tx_bad_auth', operations: [] }),
    );
    expect(await submitSignedTransaction('SIGNED', 'pass')).toEqual({ kind: 'accountMismatch' });
  });

  it('lowReserve on change_trust_low_reserve', async () => {
    h.submitTransaction.mockRejectedValue(
      new h.TransactionFailedError({
        transaction: 'tx_failed',
        operations: ['change_trust_low_reserve'],
      }),
    );
    expect(await submitSignedTransaction('SIGNED', 'pass')).toEqual({ kind: 'lowReserve' });
  });

  it('pending (poll by hash) on a network error with no result codes', async () => {
    h.submitTransaction.mockRejectedValue(new Error('ETIMEDOUT'));
    expect(await submitSignedTransaction('SIGNED', 'pass')).toEqual({
      kind: 'pending',
      hash: 'deadbeef',
    });
  });

  it('failed when the signed XDR cannot be parsed', async () => {
    h.fromXDR.mockImplementation(() => {
      throw new Error('bad xdr');
    });
    expect(await submitSignedTransaction('BAD', 'pass')).toEqual({
      kind: 'failed',
      code: 'SUBMIT_FAILED',
    });
  });
});

describe('pollTransaction', () => {
  it('confirmed when the record is successful', async () => {
    h.transactionCall.mockResolvedValue({ successful: true });
    expect(await pollTransaction('HASH')).toBe('confirmed');
  });

  it('pending on a 404 (not yet in a ledger)', async () => {
    h.transactionCall.mockRejectedValue(new h.NotFoundError());
    expect(await pollTransaction('HASH')).toBe('pending');
  });

  it('failed when the record exists but is unsuccessful', async () => {
    h.transactionCall.mockResolvedValue({ successful: false });
    expect(await pollTransaction('HASH')).toBe('failed');
  });
});
