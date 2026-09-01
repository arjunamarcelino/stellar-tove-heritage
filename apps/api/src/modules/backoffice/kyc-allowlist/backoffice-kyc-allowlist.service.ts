import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import { EntityManager } from 'typeorm';
import { ErrorCode } from '@common/enums/error-code.enum';
import { AdminRole } from '@common/enums/admin-role.enum';
import { failHttp } from '@common/http/fail-http';
import { IdempotencyStore } from '@common/idempotency/idempotency-store';
import { AuditLogService } from '@modules/wallets/audit/audit-log.service';
import { AUDIT_KIND } from '@modules/wallets/audit/audit-log.types';
import { kycAllowlistConfig } from '@config/kyc-allowlist.config';
import {
  KYC_ALLOWLIST_TX_SERVICE,
  IKycAllowlistTxService,
} from '@modules/kyc-allowlist/kyc-allowlist-tx.service.interface';
import {
  KYC_ALLOWLIST_EVENT_REPOSITORY,
  IKycAllowlistEventRepository,
} from '@modules/kyc-allowlist/repositories/kyc-allowlist-event-repository.interface';
import {
  KYC_ALLOWLIST_STATE_REPOSITORY,
  IKycAllowlistStateRepository,
} from '@modules/kyc-allowlist/repositories/kyc-allowlist-state-repository.interface';
import {
  KycAllowlistItem,
  KycAllowlistItemResult,
  NewKycAllowlistEvent,
} from '@modules/kyc-allowlist/kyc-allowlist.types';
import { RPC_CONCURRENCY } from '@modules/kyc-allowlist/kyc-allowlist.constants';
import { uuidV5 } from '@common/utils/uuid-v5.util';
import { WalletsService } from '@modules/wallets/wallets.service';
import { KycAllowlistBatchDto } from './dto/kyc-allowlist-batch.dto';
import { KycAllowlistResponseDto } from './dto/kyc-allowlist-response.dto';
import { KycAllowlistStatusResponseDto } from './dto/kyc-allowlist-status-response.dto';

/** Fixed namespace for deriving a stable v5 uuid subject_id from a wallet StrKey on read-audit rows (todo 267). */
const KYC_ALLOWLIST_WALLET_AUDIT_NS = 'a7f1c0de-2b41-5e6a-9c3d-0f1e2a3b4c5d';

/** Read-phase classification of one item against the current on-chain state. */
type Classified =
  | { index: number; item: KycAllowlistItem; kind: 'noop'; isAllowed: boolean }
  | { index: number; item: KycAllowlistItem; kind: 'actionable' }
  | { index: number; item: KycAllowlistItem; kind: 'read_failed'; error: string };

/**
 * Admin-only KYC allowlist batch orchestration (TOV-235). Idempotency `begin` precedes the on-chain reads
 * (PR#30 lesson) so a legit same-key retry replays the original body with no re-submission. Reads run in
 * parallel (capped); submissions run SERIALLY (one tx / source account / ledger on Soroban). All-no-op → 409;
 * otherwise 200 with per-item status. Events + confirmed-state mirror + one batch audit row commit atomically.
 */
@Injectable()
export class BackofficeKycAllowlistService {
  private readonly logger = new Logger(BackofficeKycAllowlistService.name);

  constructor(
    @Inject(KYC_ALLOWLIST_TX_SERVICE) private readonly tx: IKycAllowlistTxService,
    @Inject(KYC_ALLOWLIST_EVENT_REPOSITORY) private readonly events: IKycAllowlistEventRepository,
    @Inject(KYC_ALLOWLIST_STATE_REPOSITORY) private readonly state: IKycAllowlistStateRepository,
    @Inject(kycAllowlistConfig.KEY) private readonly cfg: ConfigType<typeof kycAllowlistConfig>,
    private readonly idempotency: IdempotencyStore,
    private readonly audit: AuditLogService,
    private readonly wallets: WalletsService,
  ) {}

  /**
   * TOV-241 — advisory read of the `kyc_allowlist_state` mirror for one wallet. Reuses the already-injected
   * `this.state`; a never-seen wallet maps to `isAllowed:false` (200, not 404). No on-chain call.
   *
   * Reading a person's KYC/allowlist standing is an auditable access event on a compliance surface, so every
   * read writes a `kyc.allowlist.read` audit row keyed on the admin `sub` (todo 267). The audit is
   * fail-closed (awaited, no manager → its own autocommit): if the audit log is unavailable the read errors
   * rather than silently serving compliance data unlogged — consistent with the write path's atomic audit.
   */
  async getStatus(wallet: string, adminSub: string): Promise<KycAllowlistStatusResponseDto> {
    const state = await this.state.findByWallet(wallet);
    const dto = KycAllowlistStatusResponseDto.fromState(wallet, state);
    await this.audit.record({
      actorType: 'admin',
      actorId: adminSub,
      kind: AUDIT_KIND.KYC_ALLOWLIST_READ,
      subjectType: 'kyc_allowlist_wallet',
      // subject_id is a uuid column; the wallet is a StrKey. Derive a stable v5 uuid from the wallet so the
      // (subject_type, subject_id) index still groups reads by wallet; the raw StrKey lives in the payload.
      subjectId: uuidV5(wallet, KYC_ALLOWLIST_WALLET_AUDIT_NS),
      payload: { wallet, isAllowed: dto.isAllowed, seen: state !== null },
    });
    return dto;
  }

  async process(
    dto: KycAllowlistBatchDto,
    adminSub: string,
    adminRole: AdminRole,
    idempotencyKey: string,
  ): Promise<KycAllowlistResponseDto> {
    const items: KycAllowlistItem[] = dto.items.map((i) => ({
      wallet: i.wallet,
      action: i.action,
      reason: i.reason ?? null,
    }));

    // RBAC (todo 228 + TOV-243 #438): SUPERADMIN is required to (a) remove a wallet (freezing a Collector's
    // on-chain spendability) and (b) add an EXTERNAL BYOW `G…` account — a custody-granting action (it lets
    // fractions leave platform custody via rotation), so it sits at the same bar as the reversible remove.
    // Adding a platform-custodied `C…` smart-wallet stays ADMIN+SUPERADMIN (class-level @AdminRoles).
    // Enforced here because one batch may mix actions and address kinds.
    const requiresSuperadmin = items.some(
      (i) => i.action === 'remove' || (i.action === 'add' && StrKey.isValidEd25519PublicKey(i.wallet)),
    );
    if (adminRole !== AdminRole.SUPERADMIN && requiresSuperadmin) {
      throw failHttp(
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'Removing a wallet, or adding an external BYOW (G…) settlement wallet, requires the superadmin role',
      );
    }

    // Configured operational cap (the DTO already enforced the hard ceiling). Semantic → 422.
    if (items.length > this.cfg.maxBatch) {
      throw failHttp(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.UNPROCESSABLE_ENTITY,
        `batch exceeds the configured maximum of ${this.cfg.maxBatch} items`,
      );
    }

    // Idempotency BEFORE any on-chain read (replay short-circuits state-derived rejections).
    const key = `idem:kyc-allowlist-batch:${adminSub}:${idempotencyKey}`;
    const fingerprint = this.fingerprint(adminSub, items);
    const begin = await this.idempotency.begin(key, fingerprint);
    if (begin.outcome === 'replay') return begin.body as KycAllowlistResponseDto;
    if (begin.outcome === 'in_flight') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_IN_FLIGHT, HttpStatus.CONFLICT, 'A batch with this key is still processing');
    }
    if (begin.outcome === 'mismatch') {
      throw failHttp(ErrorCode.IDEMPOTENCY_KEY_MISMATCH, HttpStatus.UNPROCESSABLE_ENTITY, 'Idempotency-Key reused with a different batch');
    }
    const { token } = begin;

    try {
      const batchId = randomUUID();

      // 1. Parallel (capped) is_allowed reads → classify noop vs actionable vs read_failed.
      const classified = await this.classify(items);

      // 2. All-no-op batch changes nothing on-chain → 409 (release the key; do not persist).
      if (classified.every((c) => c.kind === 'noop')) {
        await this.idempotency.fail(key, token);
        throw failHttp(ErrorCode.KYC_ALLOWLIST_ALL_NOOP, HttpStatus.CONFLICT, 'Every item is already in the requested state');
      }

      // 3. Seed results from the classification (noop / read_failed are terminal without a submission).
      const results: KycAllowlistItemResult[] = classified.map((c) => {
        if (c.kind === 'noop') {
          return { status: 'noop', wallet: c.item.wallet, action: c.item.action, isAllowed: c.isAllowed };
        }
        if (c.kind === 'read_failed') {
          return { status: 'failed', wallet: c.item.wallet, action: c.item.action, errorReason: c.error };
        }
        return { status: 'deferred', wallet: c.item.wallet, action: c.item.action }; // placeholder until submitted
      });

      // 4. Serial submission of actionable items. A `pending` (uncertain sequence) stops the loop and
      //    defers the rest; the small maxBatch cap (≤10) bounds the total wall-clock (todo 231).
      let stopped = false;
      for (const c of classified) {
        if (c.kind !== 'actionable') continue;
        if (stopped) {
          results[c.index] = { status: 'deferred', wallet: c.item.wallet, action: c.item.action };
          continue;
        }
        try {
          const r = await this.tx.submitOne(c.item.action, c.item.wallet);
          if (r.status === 'confirmed') {
            results[c.index] = {
              status: 'confirmed',
              wallet: c.item.wallet,
              action: c.item.action,
              isAllowed: c.item.action === 'add',
              txHash: r.txHash,
              ledger: r.ledger,
            };
          } else {
            // pending: the account sequence is uncertain until this tx closes — stop and defer the rest.
            results[c.index] = { status: 'pending', wallet: c.item.wallet, action: c.item.action, txHash: r.txHash };
            stopped = true;
          }
        } catch (err) {
          results[c.index] = {
            status: 'failed',
            wallet: c.item.wallet,
            action: c.item.action,
            errorReason: this.sanitizeReason(err),
          };
        }
      }

      // 5. TOV-243 (D7) — advisory confused-deputy guard: flag any `add` of an EXTERNAL BYOW G-address that
      //    is NOT a platform-known, SEP-10-proven wallet binding. Never blocks (allowlist-before-bind is a
      //    legitimate ordering); the flag is stamped on the audit row for compliance traceability. Only
      //    account (`G…`) adds are checked — smart-wallet `C…` addresses are platform-custodied, not external.
      const unboundExternalAdds = await this.flagUnboundExternalAdds(items, batchId);

      // 6. Persist events + confirmed-state mirror + one batch audit row, atomically.
      await this.persist(batchId, adminSub, classified, results, unboundExternalAdds);

      // 7. Store the final (post-poll) body under the key and return it.
      const body = KycAllowlistResponseDto.fromResults(results);
      await this.idempotency.complete(key, token, body);
      return body;
    } catch (err) {
      await this.idempotency.fail(key, token);
      throw err;
    }
  }

  /** Bounded-concurrency is_allowed reads (never bursts the RPC). */
  private async classify(items: KycAllowlistItem[]): Promise<Classified[]> {
    const out = new Array<Classified>(items.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < items.length) {
        const i = cursor++;
        const item = items[i];
        try {
          const isAllowed = await this.tx.isAllowed(item.wallet);
          const noop = (item.action === 'add' && isAllowed) || (item.action === 'remove' && !isAllowed);
          out[i] = noop
            ? { index: i, item, kind: 'noop', isAllowed }
            : { index: i, item, kind: 'actionable' };
        } catch (err) {
          out[i] = { index: i, item, kind: 'read_failed', error: this.sanitizeReason(err) };
        }
      }
    };
    const workers = Math.min(RPC_CONCURRENCY, items.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return out;
  }

  /**
   * TOV-243 (D7) — advisory: the set of `add`-target `G…` account StrKeys in this batch that are NOT a
   * live, platform-known BYOW wallet binding. Only account addresses are checked (`C…` smart-wallets are
   * platform-custodied, never the confused-deputy concern). Membership is intent-based, NOT result-gated:
   * an external-unbound `G…` add is flagged even if it later resolves to `noop`/`failed`, so the audit row
   * records the *attempt*. The flag is EXPECTED on the primary rotation-prep flow (allowlist-before-bind),
   * so treat it as a "review this external add" prompt, not an anomaly.
   *
   * A lookup failure is swallowed to "not flagged" (fail-open) — this is a compliance warning, not a gate,
   * and must never fail a batch whose on-chain writes already landed — but it is LOGGED at warn so a
   * systemic outage that silently disables the signal is visible.
   */
  private async flagUnboundExternalAdds(items: KycAllowlistItem[], batchId: string): Promise<Set<string>> {
    const gAdds = items
      .filter((i) => i.action === 'add' && StrKey.isValidEd25519PublicKey(i.wallet))
      .map((i) => i.wallet);
    if (gAdds.length === 0) return new Set();
    try {
      const known = await this.wallets.filterKnownActiveByowAddresses(gAdds);
      return new Set(gAdds.filter((w) => !known.has(w)));
    } catch (err) {
      // fail-open: advisory only, never fail a batch whose on-chain writes landed — but make it visible.
      this.logger.warn(
        `D7 BYOW-binding check failed; external-add warnings suppressed for this batch ` +
          `[batch=${batchId}, gAdds=${gAdds.length}]: ${this.sanitizeReason(err)}`,
      );
      return new Set();
    }
  }

  private async persist(
    batchId: string,
    adminSub: string,
    classified: Classified[],
    results: KycAllowlistItemResult[],
    unboundExternalAdds: Set<string>,
  ): Promise<void> {
    const reasonByKey = new Map(classified.map((c) => [`${c.item.wallet}:${c.item.action}`, c.item.reason ?? null]));
    const rows: NewKycAllowlistEvent[] = results.map((r) => ({
      batchId,
      wallet: r.wallet,
      action: r.action,
      adminId: adminSub,
      txHash: r.status === 'confirmed' || r.status === 'pending' ? r.txHash : null,
      reason: reasonByKey.get(`${r.wallet}:${r.action}`) ?? null,
      result: r.status,
      errorReason: r.status === 'failed' ? r.errorReason : null,
    }));

    await this.events.runInTransaction(async (manager: EntityManager) => {
      await this.events.append(rows, manager);
      // The mirror is advanced only by mutations (confirmed items). `noop` deliberately does NOT touch it:
      // the pre-submit on-chain read is authoritative and the mirror is advisory, so there's nothing to
      // record for a wallet that was already in the requested state (todo 236).
      for (const r of results) {
        if (r.status === 'confirmed') {
          await this.state.upsert(
            {
              wallet: r.wallet,
              isAllowed: r.isAllowed,
              lastAction: r.action,
              lastTxHash: r.txHash,
              lastLedger: r.ledger,
            },
            manager,
          );
        }
      }
      await this.audit.record(
        {
          actorType: 'admin',
          actorId: adminSub,
          kind: AUDIT_KIND.KYC_ALLOWLIST_PROCESSED,
          subjectType: 'kyc_allowlist_batch',
          subjectId: batchId,
          payload: {
            contractAddress: this.cfg.contractAddress,
            counts: this.counts(results),
            items: results.map((r) => ({
              wallet: r.wallet,
              action: r.action,
              result: r.status,
              txHash: r.status === 'confirmed' || r.status === 'pending' ? r.txHash : null,
              // TOV-243 (D7): compliance warning — an external BYOW G-address add attempt with no
              // proven-control wallet binding on the platform (stamped regardless of the add's on-chain
              // result). Omitted for bound wallets, all `C…` adds, and every `remove` item.
              ...(unboundExternalAdds.has(r.wallet) && r.action === 'add' ? { unboundExternalWallet: true } : {}),
            })),
          },
        },
        manager,
      );
    });
  }

  private counts(results: KycAllowlistItemResult[]): Record<string, number> {
    return results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
  }

  private fingerprint(adminSub: string, items: KycAllowlistItem[]): string {
    const canonical = JSON.stringify(
      items
        // `reason` is already DTO-constrained to lowercase; `.toLowerCase()` is belt-and-suspenders so the
        // fingerprint stays case-insensitive if that regex ever loosens (todo 236).
        .map((i) => ({ wallet: i.wallet, action: i.action, reason: i.reason?.toLowerCase() ?? null }))
        .sort((a, b) => `${a.wallet}:${a.action}`.localeCompare(`${b.wallet}:${b.action}`)),
    );
    return createHash('sha256').update(`${adminSub}|${this.cfg.contractAddress}|${canonical}`).digest('hex');
  }

  /** Collapse a raw error to a single bounded line so a raw XDR/RPC blob never lands in the DB or the response. */
  private sanitizeReason(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    return msg
      // Strip surrogate code units first, so the later slice(0,500) can never split a surrogate pair into a
      // lone surrogate that Postgres would reject as an invalid UTF-8 sequence (todo 236).
      .replace(/[\uD800-\uDFFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
  }
}
