import { describe, it, expect } from 'vitest';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AddWalletChallengeDto } from '../../../../src/modules/wallets/me/dto/add-wallet-challenge.dto';

const VALID = 'GDJVU7DRDDK4DVZJEBTW2OVCOLZBHAFGMVBJN7BV6TNFUVX5IHWRY46O';

const errorsFor = (publicKey: unknown) =>
  validateSync(plainToInstance(AddWalletChallengeDto, { publicKey }));

describe('AddWalletChallengeDto.publicKey (IsStellarPublicKey)', () => {
  it('accepts a valid ed25519 G-address', () => {
    expect(errorsFor(VALID)).toHaveLength(0);
  });

  it.each([
    ['bad checksum (well-shaped)', `${VALID.slice(0, -1)}P`],
    ['contract C-address', 'CAZOVWDKGNPMSF7GJ3FKW7M7WGTQDUKDGC3VNVSN4TQYCXBHT53LHEZC'],
    ['garbage', 'not-a-key'],
    ['empty', ''],
  ])('rejects %s', (_label, publicKey) => {
    expect(errorsFor(publicKey).length).toBeGreaterThan(0);
  });
});
