import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  rpc,
  Account,
  Asset,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { walletTrustlineConfig } from '@config/wallet-trustline.config';
import { withRpcTimeout } from '@common/soroban/with-rpc-timeout';
import {
  IWalletTrustlineService,
  TrustlineInstruction,
} from './wallet-trustline.service.interface';

// The classic asset code never varies (only the issuer does, via config).
const USDC_ASSET_CODE = 'USDC';
// The change_trust template the user's wallet signs. See the FE contract for the seq=0 rationale.
const CHANGE_TRUST_MAX_FEE = '10000'; // stroops; a max cap (only the min-needed is charged) — surge resilience.
const CHANGE_TRUST_TIMEBOUND_S = 300; // finite 5-min timebound; a fixed policy on an XDR we never submit.
const TRUSTLINE_AUTHORIZED_FLAG = 1; // xdr.TrustLineFlags.authorizedFlag — the account can hold the asset.

/**
 * BYOW USDC-trustline reader (TOV-32, FR-01.11). Reads a single CLASSIC trustline ledger entry via
 * Soroban RPC (`getLedgerEntries` serves classic Account/Trustline entries — no Horizon) and, when the
 * account does not already trust USDC, returns an unsigned `change_trust` template for the wallet to
 * sign. Mirrors the read-only `SorobanFractionReadService` shape (`rpc.Server` + `withRpcTimeout`,
 * no signing secret) but is deliberately TOTAL — see the interface JSDoc.
 *
 * The emitted template uses `sequence = 0` (SEP-7 sequence-independent): browser wallets sign the
 * envelope as-is and do not recompute the sequence, so embedding a live sequence would go stale and
 * fail `tx_bad_seq`. The FE fills the sequence at submit.
 */
@Injectable()
export class SorobanWalletTrustlineService implements IWalletTrustlineService {
  private readonly logger = new Logger(SorobanWalletTrustlineService.name);
  private readonly server: rpc.Server;

  constructor(
    @Inject(walletTrustlineConfig.KEY) private readonly cfg: ConfigType<typeof walletTrustlineConfig>,
  ) {
    this.server = new rpc.Server(cfg.rpcUrl, { allowHttp: cfg.rpcUrl.startsWith('http://') });
  }

  async resolveUsdcTrustline(publicKey: string): Promise<TrustlineInstruction | null> {
    // TOTAL by construction (load-bearing — see the interface JSDoc): every path resolves to a
    // best-effort template or null, NEVER a throw. A degenerate (non-StrKey) publicKey can't build a
    // meaningful change_trust, so omit — this guard keeps the fall-through buildInstruction (which
    // constructs a Keypair/Account) structurally unable to throw.
    if (!StrKey.isValidEd25519PublicKey(publicKey)) return null;
    // `asset` is derived from boot-validated config (issuer via StrKey), so it cannot throw per-request.
    const asset = new Asset(USDC_ASSET_CODE, this.cfg.usdcAssetIssuer);
    try {
      const accountId = Keypair.fromPublicKey(publicKey).xdrAccountId();
      const trustlineKey = xdr.LedgerKey.trustline(
        new xdr.LedgerKeyTrustLine({ accountId, asset: asset.toTrustLineXDRObject() }),
      );
      // seq=0 template ⇒ no account read needed; query only the trustline key (one RPC round-trip).
      const resp = await withRpcTimeout(
        'wallet trustline',
        'getLedgerEntries',
        this.server.getLedgerEntries(trustlineKey),
        this.cfg.timeoutMs,
      );
      const entry = resp.entries[0];
      // Compare against the SDK enum SINGLETON, not the `switch().name` string — that string is
      // 'trustline' (lowercase L; only the accessor is `.trustLine()`), so a string compare would
      // silently never match and emit the instruction for every already-trusting wallet.
      if (entry && entry.val.switch() === xdr.LedgerEntryType.trustline()) {
        const flags = entry.val.trustLine().flags();
        // Present AND authorized ⇒ the account can already receive USDC — omit the instruction. The
        // authorized-bit check only matters for an `auth_required` issuer; Circle USDC is NOT
        // auth_required, so a USDC trustline is always auto-authorized (flags=1) and this branch is
        // effectively always taken when present. It's defensive against a misconfigured regulated
        // issuer — where a change_trust wouldn't help anyway (only the issuer can authorize).
        if ((flags & TRUSTLINE_AUTHORIZED_FLAG) === TRUSTLINE_AUTHORIZED_FLAG) return null;
      }
    } catch (err) {
      // Fail-open: a read failure must never block the wallet-add. change_trust is idempotent, so a
      // spurious prompt no-ops in the wallet — a Collector is never silently unable to receive USDC.
      // Keep the raw RPC detail at debug (it can carry the RPC host) — the warn stays clean.
      this.logger.warn(`trustline read failed for ${publicKey}; failing open`);
      this.logger.debug(err instanceof Error ? err.message : String(err));
    }
    // Reached on absent / unauthorized / read-failure. publicKey is validated + asset is boot-valid,
    // so this cannot throw — resolveUsdcTrustline is structurally total.
    return this.buildInstruction(publicKey, asset);
  }

  /** Build the unsigned seq=0 `change_trust` template (no trust limit ⇒ SDK max). */
  private buildInstruction(publicKey: string, asset: Asset): TrustlineInstruction {
    // Source seq '-1' → TransactionBuilder.build() increments it to 0, yielding a TRUE SEP-7
    // sequence-independent template (tx.sequence === '0'). Passing '0' would build tx.sequence '1',
    // which a SEP-7 handler would NOT auto-replace. The FE fills the live sequence at submit.
    const source = new Account(publicKey, '-1');
    const tx = new TransactionBuilder(source, {
      fee: CHANGE_TRUST_MAX_FEE,
      networkPassphrase: this.cfg.networkPassphrase,
    })
      .addOperation(Operation.changeTrust({ asset }))
      .setTimeout(CHANGE_TRUST_TIMEBOUND_S)
      .build();
    return {
      changeTrustXdr: tx.toXDR(),
      asset: { code: asset.getCode(), issuer: asset.getIssuer() },
    };
  }
}
