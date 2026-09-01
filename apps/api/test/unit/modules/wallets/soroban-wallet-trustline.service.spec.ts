import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ConfigType } from '@nestjs/config';
import {
  rpc,
  Asset,
  Keypair,
  Networks,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { SorobanWalletTrustlineService } from '../../../../src/modules/wallets/soroban-wallet-trustline.service';
import { walletTrustlineConfig } from '../../../../src/config/wallet-trustline.config';
import type { TrustlineInstruction } from '../../../../src/modules/wallets/wallet-trustline.service.interface';

// Real testnet G-addresses (never touched over the wire — the RPC is stubbed).
const HOLDER = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_CODE = 'USDC';

// `xdr.TrustLineFlags.authorizedFlag().value` is 1; flags=0 is present-but-unauthorized.
const AUTHORIZED = 1;
const UNAUTHORIZED = 0;

// Structurally assignable to the ConfigType (no cast) — the annotation just proves it.
const cfg: ConfigType<typeof walletTrustlineConfig> = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  usdcAssetIssuer: ISSUER,
  timeoutMs: 1200,
};

/** The real classic trustline ledger-entry union arm, built + decoded by the actual xdr codec. */
function trustlineEntryVal(flags: number): xdr.LedgerEntryData {
  const accountId = Keypair.fromPublicKey(HOLDER).xdrAccountId();
  const asset = new Asset(USDC_CODE, ISSUER);
  return xdr.LedgerEntryData.trustline(
    new xdr.TrustLineEntry({
      accountId,
      asset: asset.toTrustLineXDRObject(),
      balance: new xdr.Int64(0),
      limit: xdr.Int64.fromString('9223372036854775807'),
      flags,
      ext: new xdr.TrustLineEntryExt(0),
    }),
  );
}

function trustlineKey(): xdr.LedgerKey {
  const accountId = Keypair.fromPublicKey(HOLDER).xdrAccountId();
  const asset = new Asset(USDC_CODE, ISSUER);
  return xdr.LedgerKey.trustline(
    new xdr.LedgerKeyTrustLine({ accountId, asset: asset.toTrustLineXDRObject() }),
  );
}

/** A real `getLedgerEntries` response carrying a present trustline with the given flags. */
function presentTrustlineResponse(flags: number): rpc.Api.GetLedgerEntriesResponse {
  const entry: rpc.Api.LedgerEntryResult = {
    key: trustlineKey(),
    val: trustlineEntryVal(flags),
    lastModifiedLedgerSeq: 100,
    liveUntilLedgerSeq: 200,
  };
  return { latestLedger: 12345, entries: [entry] };
}

/** An empty response — the trustline key does not exist on-ledger. */
function absentTrustlineResponse(): rpc.Api.GetLedgerEntriesResponse {
  return { latestLedger: 12345, entries: [] };
}

/** Decode the emitted template with the real codec and assert it is a seq=0 change_trust for USDC. */
function assertUsdcSeqZeroTemplate(instruction: TrustlineInstruction): void {
  expect(instruction.asset).toEqual({ code: USDC_CODE, issuer: ISSUER });
  const decoded = TransactionBuilder.fromXDR(instruction.changeTrustXdr, Networks.TESTNET);
  expect(decoded).toBeInstanceOf(Transaction);
  if (!(decoded instanceof Transaction)) throw new Error('expected a classic Transaction');
  expect(decoded.operations).toHaveLength(1);
  const op = decoded.operations[0];
  expect(op.type).toBe('changeTrust');
  if (op.type !== 'changeTrust') throw new Error('expected a changeTrust operation');
  expect(op.line).toBeInstanceOf(Asset);
  if (!(op.line instanceof Asset)) throw new Error('expected a credit Asset trust line');
  expect(op.line.getCode()).toBe(USDC_CODE);
  expect(op.line.getIssuer()).toBe(ISSUER);
  // The load-bearing SEP-7 property: a true sequence-independent template.
  expect(decoded.sequence).toBe('0');
}

describe('SorobanWalletTrustlineService.resolveUsdcTrustline', () => {
  let service: SorobanWalletTrustlineService;
  let getLedgerEntries: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getLedgerEntries = vi.spyOn(rpc.Server.prototype, 'getLedgerEntries');
    service = new SorobanWalletTrustlineService(cfg);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when the account already trusts USDC (present & authorized, flags=1)', async () => {
    // BLOCKER REGRESSION: the service must compare the union arm against the enum SINGLETON
    // `xdr.LedgerEntryType.trustline()`, NOT the string 'trustLine'. A string compare silently
    // never matches, so this genuinely-present authorized entry would wrongly emit an instruction.
    getLedgerEntries.mockResolvedValue(presentTrustlineResponse(AUTHORIZED));
    const result = await service.resolveUsdcTrustline(HOLDER);
    expect(result).toBeNull();
  });

  it('returns an instruction when the trustline is present but UNAUTHORIZED (flags=0)', async () => {
    getLedgerEntries.mockResolvedValue(presentTrustlineResponse(UNAUTHORIZED));
    const result = await service.resolveUsdcTrustline(HOLDER);
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected an instruction');
    assertUsdcSeqZeroTemplate(result);
  });

  it('returns a seq=0 change_trust instruction when the trustline is absent (no entry)', async () => {
    getLedgerEntries.mockResolvedValue(absentTrustlineResponse());
    const result = await service.resolveUsdcTrustline(HOLDER);
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected an instruction');
    assertUsdcSeqZeroTemplate(result);
  });

  it('fails open (returns an instruction) when getLedgerEntries rejects — never throws', async () => {
    getLedgerEntries.mockRejectedValue(new Error('ECONNRESET at soroban-testnet'));
    const result = await service.resolveUsdcTrustline(HOLDER);
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a fail-open instruction');
    assertUsdcSeqZeroTemplate(result);
  });

  it('is TOTAL for a malformed public key: returns null without throwing or reading the ledger', async () => {
    // Guards the load-bearing "never throws" contract — buildInstruction would otherwise throw on
    // `new Account(<bad key>, '-1')`, escaping the method and stranding a bound wallet on every replay.
    const result = await service.resolveUsdcTrustline('not-a-valid-strkey');
    expect(result).toBeNull();
    expect(getLedgerEntries).not.toHaveBeenCalled();
  });
});
