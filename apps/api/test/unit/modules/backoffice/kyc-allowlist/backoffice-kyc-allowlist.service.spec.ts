import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { StrKey } from '@stellar/stellar-sdk';
import { BackofficeKycAllowlistService } from '../../../../../src/modules/backoffice/kyc-allowlist/backoffice-kyc-allowlist.service';
import { KycAllowlistBatchDto } from '../../../../../src/modules/backoffice/kyc-allowlist/dto/kyc-allowlist-batch.dto';
import { ErrorCode } from '../../../../../src/common/enums/error-code.enum';
import { AdminRole } from '../../../../../src/common/enums/admin-role.enum';
import { AUDIT_KIND } from '../../../../../src/modules/wallets/audit/audit-log.types';
import type { ConfigType } from '@nestjs/config';
import { NewKycAllowlistEvent } from '../../../../../src/modules/kyc-allowlist/kyc-allowlist.types';
import { KycAllowlistStateUpsert } from '../../../../../src/modules/kyc-allowlist/repositories/kyc-allowlist-state-repository.interface';
import type { IKycAllowlistEventRepository } from '../../../../../src/modules/kyc-allowlist/repositories/kyc-allowlist-event-repository.interface';
import { KycAllowlistState } from '../../../../../src/modules/kyc-allowlist/entities/kyc-allowlist-state.entity';
import type { NewAuditEntry } from '../../../../../src/modules/wallets/audit/audit-log.types';
import type { AuditLogService } from '../../../../../src/modules/wallets/audit/audit-log.service';
import type { WalletsService } from '../../../../../src/modules/wallets/wallets.service';
import type { IdempotencyStore } from '../../../../../src/common/idempotency/idempotency-store';
import { kycAllowlistConfig } from '../../../../../src/config/kyc-allowlist.config';
import { FakeKycAllowlistService } from '../../../../shared/fake-kyc-allowlist';
import { InMemoryIdempotencyStore } from '../../../../shared/in-memory-idempotency-store';

const contract = (n: number): string => StrKey.encodeContract(Buffer.alloc(32, n));
const W1 = contract(1);
const W2 = contract(2);
const ADMIN = '11111111-1111-1111-1111-111111111111';
const SUPER = AdminRole.SUPERADMIN;
const CONTRACT = contract(99);

type Row = NewKycAllowlistEvent;

function harness(maxBatch = 5) {
  const tx = new FakeKycAllowlistService();
  const appended: Row[] = [];
  const upserts: KycAllowlistStateUpsert[] = [];
  const audited: NewAuditEntry[] = [];

  // Mocks typed to the used subset of each collaborator's interface, so a contract change fails compilation
  // here rather than silently passing against a stale shape (todo 269 — replaces the old `as never` casts).
  const events: Pick<IKycAllowlistEventRepository, 'append' | 'runInTransaction'> = {
    append: (rows) => {
      appended.push(...rows);
      return Promise.resolve();
    },
    runInTransaction: (work) => work({} as never),
  };
  const state = {
    upsert: (i: KycAllowlistStateUpsert) => {
      upserts.push(i);
      return Promise.resolve();
    },
    findByWallet: vi.fn().mockResolvedValue(null),
  };
  const audit: Pick<AuditLogService, 'record'> = {
    record: (e: NewAuditEntry) => {
      audited.push(e);
      return Promise.resolve();
    },
  };
  const cfg: Pick<ConfigType<typeof kycAllowlistConfig>, 'contractAddress' | 'maxBatch'> = { contractAddress: CONTRACT, maxBatch };
  const idempotency = new InMemoryIdempotencyStore();
  // TOV-243 (D7): advisory BYOW-binding check. Default treats every queried key as a known binding (returns
  // them all), so pre-existing C-address tests — which never trigger the check anyway — see no warning;
  // individual G-address tests override per case.
  const wallets: Pick<WalletsService, 'filterKnownActiveByowAddresses'> = {
    filterKnownActiveByowAddresses: vi.fn((keys: string[]) => Promise.resolve(new Set(keys))),
  };

  const svc = new BackofficeKycAllowlistService(
    tx,
    events as unknown as IKycAllowlistEventRepository,
    state,
    cfg as unknown as ConfigType<typeof kycAllowlistConfig>,
    idempotency as unknown as IdempotencyStore,
    audit as unknown as AuditLogService,
    wallets as unknown as WalletsService,
  );
  return { svc, tx, appended, upserts, audited, state, wallets };
}

const dto = (items: { wallet: string; action: 'add' | 'remove'; reason?: string }[]): KycAllowlistBatchDto =>
  ({ items });

async function expectHttp(p: Promise<unknown>, status: HttpStatus, errorCode?: ErrorCode): Promise<void> {
  try {
    await p;
    throw new Error('expected an HttpException but the promise resolved');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const ex = e as HttpException;
    expect(ex.getStatus()).toBe(status);
    if (errorCode) expect((ex.getResponse() as { errorCode: ErrorCode }).errorCode).toBe(errorCode);
  }
}

describe('BackofficeKycAllowlistService', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  // --- positive ---
  it('adds a fresh wallet → confirmed, mirror is_allowed=true, audit + event written', async () => {
    const res = await h.svc.process(dto([{ wallet: W1, action: 'add', reason: 'kyc_passed' }]), ADMIN, SUPER, 'k1');
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ wallet: W1, action: 'add', status: 'confirmed', isAllowed: true });
    expect(res.results[0].txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.tx.submitCalls).toEqual([{ action: 'add', wallet: W1 }]);
    expect(h.upserts).toEqual([expect.objectContaining({ wallet: W1, isAllowed: true, lastAction: 'add' })]);
    expect(h.appended).toHaveLength(1);
    expect(h.appended[0]).toMatchObject({ wallet: W1, action: 'add', result: 'confirmed', reason: 'kyc_passed' });
    expect(h.audited[0]).toMatchObject({ kind: AUDIT_KIND.KYC_ALLOWLIST_PROCESSED, subjectType: 'kyc_allowlist_batch' });
  });

  it('removes an allowed wallet → confirmed, mirror is_allowed=false', async () => {
    h.tx.setAllowed(W1);
    const res = await h.svc.process(dto([{ wallet: W1, action: 'remove' }]), ADMIN, SUPER, 'k1');
    expect(res.results[0]).toMatchObject({ status: 'confirmed', isAllowed: false });
    expect(h.upserts[0]).toMatchObject({ wallet: W1, isAllowed: false, lastAction: 'remove' });
  });

  // --- TOV-243 (D7): advisory confused-deputy warning on external BYOW G-address adds ---
  const G = 'GB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJJRMA';
  const auditItems = (audited: NewAuditEntry[]): { wallet: string; unboundExternalWallet?: boolean }[] =>
    (audited.find((a) => a.kind === AUDIT_KIND.KYC_ALLOWLIST_PROCESSED)!.payload as {
      items: { wallet: string; unboundExternalWallet?: boolean }[];
    }).items;

  it('add of a G-address that IS a known BYOW binding → no unbound warning on the audit row', async () => {
    (h.wallets.filterKnownActiveByowAddresses as ReturnType<typeof vi.fn>).mockResolvedValue(new Set([G]));
    await h.svc.process(dto([{ wallet: G, action: 'add' }]), ADMIN, SUPER, 'k1');
    expect(h.wallets.filterKnownActiveByowAddresses).toHaveBeenCalledWith([G]);
    expect(auditItems(h.audited).find((i) => i.wallet === G)?.unboundExternalWallet).toBeUndefined();
  });

  it('add of a G-address NOT bound on the platform → unboundExternalWallet:true stamped on the audit row', async () => {
    (h.wallets.filterKnownActiveByowAddresses as ReturnType<typeof vi.fn>).mockResolvedValue(new Set<string>());
    await h.svc.process(dto([{ wallet: G, action: 'add' }]), ADMIN, SUPER, 'k1');
    expect(auditItems(h.audited).find((i) => i.wallet === G)?.unboundExternalWallet).toBe(true);
  });

  it('add of a C-address contract wallet → binding check skipped, no warning (platform-custodied)', async () => {
    await h.svc.process(dto([{ wallet: W1, action: 'add' }]), ADMIN, SUPER, 'k1');
    expect(h.wallets.filterKnownActiveByowAddresses).not.toHaveBeenCalled();
    expect(auditItems(h.audited).find((i) => i.wallet === W1)?.unboundExternalWallet).toBeUndefined();
  });

  // --- RBAC (todo 228): remove requires superadmin ---
  it('remove by a non-superadmin (ADMIN) → 403 FORBIDDEN', async () => {
    h.tx.setAllowed(W1);
    await expectHttp(
      h.svc.process(dto([{ wallet: W1, action: 'remove' }]), ADMIN, AdminRole.ADMIN, 'k1'),
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
    );
    expect(h.tx.submitCalls).toHaveLength(0);
  });

  it('add of a C-address by a non-superadmin (ADMIN) is allowed', async () => {
    const res = await h.svc.process(dto([{ wallet: W1, action: 'add' }]), ADMIN, AdminRole.ADMIN, 'k1');
    expect(res.results[0].status).toBe('confirmed');
  });

  it('add of an external G-address by a non-superadmin (ADMIN) → 403 (TOV-243 #438)', async () => {
    await expectHttp(
      h.svc.process(dto([{ wallet: G, action: 'add' }]), ADMIN, AdminRole.ADMIN, 'k1'),
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
    );
    expect(h.tx.submitCalls).toHaveLength(0);
  });

  it('add of an external G-address by SUPERADMIN is allowed', async () => {
    const res = await h.svc.process(dto([{ wallet: G, action: 'add' }]), ADMIN, SUPER, 'k1');
    expect(res.results[0].status).toBe('confirmed');
  });

  // --- edge: no-op detection ---
  it('all-noop batch → 409 KYC_ALLOWLIST_ALL_NOOP, nothing submitted or persisted', async () => {
    h.tx.setAllowed(W1); // already allowed → add is a no-op
    await expectHttp(
      h.svc.process(dto([{ wallet: W1, action: 'add' }]), ADMIN, SUPER, 'k1'),
      HttpStatus.CONFLICT,
      ErrorCode.KYC_ALLOWLIST_ALL_NOOP,
    );
    expect(h.tx.submitCalls).toHaveLength(0);
    expect(h.appended).toHaveLength(0);
  });

  it('mixed batch → 200 with confirmed + noop per-item; only the actionable item is submitted', async () => {
    h.tx.setAllowed(W2); // W2 add is a no-op
    const res = await h.svc.process(dto([{ wallet: W1, action: 'add' }, { wallet: W2, action: 'add' }]), ADMIN, SUPER, 'k1');
    const byWallet = Object.fromEntries(res.results.map((r) => [r.wallet, r.status]));
    expect(byWallet[W1]).toBe('confirmed');
    expect(byWallet[W2]).toBe('noop');
    expect(h.tx.submitCalls).toEqual([{ action: 'add', wallet: W1 }]);
    expect(h.appended).toHaveLength(2);
  });

  // --- edge: pending stops and defers the rest ---
  it('pending item stops submission and defers the remainder', async () => {
    h.tx.pendingOn(W1);
    const res = await h.svc.process(dto([{ wallet: W1, action: 'add' }, { wallet: W2, action: 'add' }]), ADMIN, SUPER, 'k1');
    const byWallet = Object.fromEntries(res.results.map((r) => [r.wallet, r.status]));
    expect(byWallet[W1]).toBe('pending');
    expect(byWallet[W2]).toBe('deferred');
    expect(h.tx.submitCalls).toEqual([{ action: 'add', wallet: W1 }]); // W2 never submitted
    expect(h.upserts).toHaveLength(0); // nothing confirmed → mirror untouched
  });

  // --- negative: submission failure ---
  it('submit failure → per-item failed with a sanitized reason; others proceed', async () => {
    h.tx.failOn(W1);
    const res = await h.svc.process(dto([{ wallet: W1, action: 'add' }, { wallet: W2, action: 'add' }]), ADMIN, SUPER, 'k1');
    const byWallet = Object.fromEntries(res.results.map((r) => [r.wallet, r.status]));
    expect(byWallet[W1]).toBe('failed');
    expect(byWallet[W2]).toBe('confirmed');
    const failed = res.results.find((r) => r.wallet === W1)!;
    expect(failed.errorReason).toContain('fake submit failure');
  });

  it('read failure → per-item failed at the read phase; wallet never submitted', async () => {
    h.tx.readFailOn(W1);
    const res = await h.svc.process(dto([{ wallet: W1, action: 'add' }]), ADMIN, SUPER, 'k1');
    expect(res.results[0].status).toBe('failed');
    expect(h.tx.submitCalls).toHaveLength(0);
  });

  // --- edge: idempotency ---
  it('same key + body replays the stored body without a second submission', async () => {
    const body1 = await h.svc.process(dto([{ wallet: W1, action: 'add' }]), ADMIN, SUPER, 'k1');
    const readSpy = vi.spyOn(h.tx, 'isAllowed');
    const body2 = await h.svc.process(dto([{ wallet: W1, action: 'add' }]), ADMIN, SUPER, 'k1');
    expect(body2).toEqual(body1);
    expect(h.tx.submitCalls).toHaveLength(1); // no second submit
    expect(readSpy).not.toHaveBeenCalled(); // replay short-circuits before the reads
  });

  it('same key + different items → 422 mismatch', async () => {
    await h.svc.process(dto([{ wallet: W1, action: 'add' }]), ADMIN, SUPER, 'k1');
    await expectHttp(
      h.svc.process(dto([{ wallet: W2, action: 'add' }]), ADMIN, SUPER, 'k1'),
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.IDEMPOTENCY_KEY_MISMATCH,
    );
  });

  // --- negative: configured cap ---
  it('over the configured maxBatch → 422', async () => {
    const h1 = harness(1);
    await expectHttp(
      h1.svc.process(dto([{ wallet: W1, action: 'add' }, { wallet: W2, action: 'add' }]), ADMIN, SUPER, 'k1'),
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCode.VALIDATION_FAILED,
    );
    expect(h1.tx.submitCalls).toHaveLength(0);
  });

  // --- getStatus (TOV-241): advisory mirror read + access audit ---
  it('getStatus: never-seen wallet (repo → null) → isAllowed:false with null provenance, no submission', async () => {
    const res = await h.svc.getStatus(W1, ADMIN);
    expect(res).toEqual({ wallet: W1, isAllowed: false, lastAction: null, lastTxHash: null, lastLedger: null, updatedAt: null });
    expect(h.state.findByWallet).toHaveBeenCalledWith(W1);
    expect(h.tx.submitCalls).toHaveLength(0);
  });

  it('getStatus: writes a kyc.allowlist.read audit row keyed on the admin sub (todo 267)', async () => {
    await h.svc.getStatus(W1, ADMIN);
    expect(h.audited).toHaveLength(1);
    expect(h.audited[0]).toMatchObject({
      kind: AUDIT_KIND.KYC_ALLOWLIST_READ,
      subjectType: 'kyc_allowlist_wallet',
      actorId: ADMIN,
    });
    // subject_id is a derived v5 uuid (wallet is a StrKey, not a uuid); the raw wallet lives in the payload.
    expect((h.audited[0] as { subjectId: string }).subjectId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect((h.audited[0].payload as { wallet: string }).wallet).toBe(W1);
  });

  it('getStatus: allowed wallet (repo → row) → maps the mirror row', async () => {
    h.state.findByWallet.mockResolvedValueOnce({
      wallet: W1,
      isAllowed: true,
      lastAction: 'add',
      lastTxHash: 'a'.repeat(64),
      lastLedger: '512345',
      createdAt: new Date('2026-08-18T00:00:00.000Z'),
      updatedAt: new Date('2026-08-18T10:00:00.000Z'),
    } satisfies KycAllowlistState);
    const res = await h.svc.getStatus(W1, ADMIN);
    expect(res).toMatchObject({ wallet: W1, isAllowed: true, lastAction: 'add', lastLedger: '512345', updatedAt: '2026-08-18T10:00:00.000Z' });
  });

  it('getStatus: removed wallet (is_allowed=false, last_action=remove) → isAllowed:false but provenance present', async () => {
    h.state.findByWallet.mockResolvedValueOnce({
      wallet: W1,
      isAllowed: false,
      lastAction: 'remove',
      lastTxHash: 'b'.repeat(64),
      lastLedger: '512400',
      createdAt: new Date('2026-08-18T00:00:00.000Z'),
      updatedAt: new Date('2026-08-18T11:00:00.000Z'),
    } satisfies KycAllowlistState);
    const res = await h.svc.getStatus(W1, ADMIN);
    expect(res.isAllowed).toBe(false);
    expect(res.lastAction).toBe('remove'); // distinct from never-seen (which is lastAction:null)
  });
});
