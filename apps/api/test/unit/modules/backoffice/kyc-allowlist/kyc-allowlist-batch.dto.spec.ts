import { describe, it, expect } from 'vitest';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StrKey } from '@stellar/stellar-sdk';
import { KycAllowlistBatchDto } from '../../../../../src/modules/backoffice/kyc-allowlist/dto/kyc-allowlist-batch.dto';

/** Deterministic valid contract StrKeys (correct CRC16 checksum). */
const contract = (n: number): string => StrKey.encodeContract(Buffer.alloc(32, n));
const W1 = contract(1);
const W2 = contract(2);
// Shape-valid (^C[A-Z2-7]{55}$) but checksum-invalid: flip the last char.
const BAD_CHECKSUM = `${W1.slice(0, 55)}${W1[55] === 'A' ? 'B' : 'A'}`;

const validate = (payload: unknown) =>
  validateSync(plainToInstance(KycAllowlistBatchDto, payload), { whitelist: true, forbidNonWhitelisted: true });

describe('KycAllowlistBatchDto', () => {
  // --- positive ---
  it('accepts a single add item', () => {
    expect(validate({ items: [{ wallet: W1, action: 'add', reason: 'kyc_passed' }] })).toHaveLength(0);
  });

  it('accepts a mixed batch and an item without a reason', () => {
    expect(
      validate({ items: [{ wallet: W1, action: 'add' }, { wallet: W2, action: 'remove', reason: 'kyc_revoked' }] }),
    ).toHaveLength(0);
  });

  // --- negative: array-level ---
  it('rejects an empty items array', () => {
    expect(validate({ items: [] }).length).toBeGreaterThan(0);
  });

  it('rejects a batch over the hard ceiling (11 items)', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ wallet: contract(i + 10), action: 'add' }));
    expect(validate({ items }).length).toBeGreaterThan(0);
  });

  it('rejects duplicate (wallet, action) pairs', () => {
    expect(validate({ items: [{ wallet: W1, action: 'add' }, { wallet: W1, action: 'add' }] }).length).toBeGreaterThan(0);
  });

  it('accepts the same wallet with different actions (not a duplicate)', () => {
    expect(validate({ items: [{ wallet: W1, action: 'add' }, { wallet: W1, action: 'remove' }] })).toHaveLength(0);
  });

  it('accepts a BYOW classic account (G…) alongside a contract (C…) in one batch (TOV-243)', () => {
    const G = 'GB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJJRMA';
    expect(validate({ items: [{ wallet: W1, action: 'add' }, { wallet: G, action: 'add' }] })).toHaveLength(0);
  });

  // --- negative: item-level (guards @Type/@ValidateNested wiring) ---
  it.each([
    ['muxed M-address', 'MB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJIAAAAAAAAAAAAHKSA'],
    ['checksum-invalid', BAD_CHECKSUM],
    ['too short', 'CBRHXSWJ'],
    ['empty', ''],
  ])('rejects a bad wallet inside an otherwise-good batch: %s', (_label, wallet) => {
    expect(validate({ items: [{ wallet: W1, action: 'add' }, { wallet, action: 'add' }] }).length).toBeGreaterThan(0);
  });

  it.each([
    ['unknown action', { wallet: W1, action: 'freeze' }],
    ['missing action', { wallet: W1 }],
    ['missing wallet', { action: 'add' }],
    ['reason uppercase', { wallet: W1, action: 'add', reason: 'KYC_Passed' }],
    ['reason with spaces', { wallet: W1, action: 'add', reason: 'kyc passed' }],
    ['reason too long', { wallet: W1, action: 'add', reason: 'x'.repeat(65) }],
  ])('rejects %s', (_label, item) => {
    expect(validate({ items: [item] }).length).toBeGreaterThan(0);
  });
});
