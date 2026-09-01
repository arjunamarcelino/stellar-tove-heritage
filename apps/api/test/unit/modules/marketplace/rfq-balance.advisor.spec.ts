import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { RfqBalanceAdvisor } from '../../../../src/modules/marketplace/rfqs/rfq-balance.advisor';
import { EmbeddedWalletNotFoundError } from '../../../../src/modules/wallets/embedded-wallet-not-found.error';
import { RelayerTransferError } from '../../../../src/modules/relayer/relayer.errors';

const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const WALLET = 'CDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const USER = 'u-1';

function build(available = '1000000000000') {
  const walletsService = {
    resolveEmbeddedWalletForUser: vi.fn(() =>
      Promise.resolve({ contractAddress: WALLET, credential: { credentialId: 'c', transports: null, publicKey: Buffer.alloc(0) } }),
    ),
  };
  const relayer = {
    readWalletHoldings: vi.fn(() => Promise.resolve([{ tokenContract: USDC, amountScaled: available }])),
  };
  const relayerCfg = { usdcTokenAddress: USDC };
  const advisor = new RfqBalanceAdvisor(walletsService as never, relayer as never, relayerCfg as never);
  return { advisor, walletsService, relayer };
}

describe('RfqBalanceAdvisor.warnIfInsufficient', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns undefined when the balance is sufficient (reads USDC for the resolved wallet)', async () => {
    const h = build('5000000000');
    await expect(h.advisor.warnIfInsufficient(USER, 1_000_000_000n)).resolves.toBeUndefined();
    expect(h.walletsService.resolveEmbeddedWalletForUser).toHaveBeenCalledWith(USER);
    expect(h.relayer.readWalletHoldings).toHaveBeenCalledWith({ walletContract: WALLET, tokenContracts: [USDC] });
  });

  it('returns the shortfall when the balance is insufficient', async () => {
    const h = build('1000000000000');
    await expect(h.advisor.warnIfInsufficient(USER, 2_000_000_000_000n)).resolves.toEqual({
      requiredStroops: '2000000000000',
      availableStroops: '1000000000000',
    });
  });

  it('treats a missing holding as 0 → warns', async () => {
    const h = build();
    h.relayer.readWalletHoldings.mockResolvedValueOnce([]);
    await expect(h.advisor.warnIfInsufficient(USER, 1n)).resolves.toEqual({
      requiredStroops: '1',
      availableStroops: '0',
    });
  });

  it('swallows a missing embedded wallet → undefined, logged at debug (expected)', async () => {
    const h = build();
    h.walletsService.resolveEmbeddedWalletForUser.mockRejectedValueOnce(new EmbeddedWalletNotFoundError('none'));
    await expect(h.advisor.warnIfInsufficient(USER, 1n)).resolves.toBeUndefined();
    expect(debugSpy).toHaveBeenCalledOnce();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('swallows a relayer failure → undefined, logged at debug (expected)', async () => {
    const h = build();
    h.relayer.readWalletHoldings.mockRejectedValueOnce(new RelayerTransferError('unavailable'));
    await expect(h.advisor.warnIfInsufficient(USER, 1n)).resolves.toBeUndefined();
    expect(debugSpy).toHaveBeenCalledOnce();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs an UNEXPECTED error at warn (observability), still returns undefined', async () => {
    const h = build();
    h.relayer.readWalletHoldings.mockRejectedValueOnce(new TypeError('bad config'));
    await expect(h.advisor.warnIfInsufficient(USER, 1n)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('drops the warning (and logs at debug) when the read exceeds the deadline', async () => {
    const h = build();
    h.relayer.readWalletHoldings.mockReturnValueOnce(new Promise(() => undefined)); // never resolves
    vi.useFakeTimers();
    const p = h.advisor.warnIfInsufficient(USER, 1n);
    await vi.advanceTimersByTimeAsync(1300); // > BALANCE_WARN_DEADLINE_MS (1200)
    await expect(p).resolves.toBeUndefined();
    expect(debugSpy).toHaveBeenCalledOnce(); // timeout is an expected soft failure
  });
});
