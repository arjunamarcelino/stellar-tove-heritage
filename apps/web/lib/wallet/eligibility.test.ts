import { describe, it, expect } from 'vitest';
import { isRemovable, canSetPrimary } from '@/lib/wallet/eligibility';
import {
  fakeEmbeddedWallet,
  fakeByowWallet,
  fakeAddedByowWallet,
  fakePrimaryWallet,
  fakeExportedByowWallet,
} from '@/test/fixtures/walletExport';

describe('isRemovable', () => {
  it('is false for an embedded wallet (offboards via export, not remove)', () => {
    expect(isRemovable(fakeEmbeddedWallet)).toBe(false);
  });

  it('is false for a BYOW wallet with unknown isPrimary (conservative)', () => {
    expect(isRemovable(fakeByowWallet)).toBe(false);
  });

  it('is true for a non-primary BYOW wallet', () => {
    expect(isRemovable(fakeAddedByowWallet)).toBe(true);
  });

  it('is false for the primary wallet', () => {
    expect(isRemovable(fakePrimaryWallet)).toBe(false);
  });

  it('is true for an exported non-primary BYOW wallet', () => {
    expect(isRemovable(fakeExportedByowWallet)).toBe(true);
  });
});

describe('canSetPrimary', () => {
  it('is false for an embedded wallet', () => {
    expect(canSetPrimary(fakeEmbeddedWallet)).toBe(false);
  });

  it('is false for a BYOW wallet with unknown isPrimary (conservative)', () => {
    expect(canSetPrimary(fakeByowWallet)).toBe(false);
  });

  it('is true for a non-primary, non-exported BYOW wallet', () => {
    expect(canSetPrimary(fakeAddedByowWallet)).toBe(true);
  });

  it('is false for the primary wallet', () => {
    expect(canSetPrimary(fakePrimaryWallet)).toBe(false);
  });

  // The key `!exported` assertion: an exported BYOW is removable but NOT eligible for set-primary
  // (matches the backend 409 WALLET_NOT_ELIGIBLE_FOR_PRIMARY).
  it('is false for an exported non-primary BYOW wallet (load-bearing !exported clause)', () => {
    expect(canSetPrimary(fakeExportedByowWallet)).toBe(false);
    expect(isRemovable(fakeExportedByowWallet)).toBe(true);
  });
});
