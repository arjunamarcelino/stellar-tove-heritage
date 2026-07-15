import { describe, it, expect, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { WalletsService } from '../../../../src/modules/wallets/wallets.service';
import { EmbeddedWalletNotFoundError } from '../../../../src/modules/wallets/embedded-wallet-not-found.error';
import { IWalletRepository } from '../../../../src/modules/wallets/repositories/wallet-repository.interface';
import { IPasskeyCredentialRepository } from '../../../../src/modules/wallets/repositories/passkey-credential-repository.interface';
import { Wallet } from '../../../../src/modules/wallets/entities/wallet.entity';
import { PasskeyCredential } from '../../../../src/modules/wallets/entities/passkey-credential.entity';
import { UsersService } from '../../../../src/modules/users/users.service';
import { AuditLogService } from '../../../../src/modules/wallets/audit/audit-log.service';

// Direct-instantiation unit test (mirrors sep10/passkey service specs): fake repos, only the deps
// resolveEmbeddedWalletForUser touches are wired.
describe('WalletsService.resolveEmbeddedWalletForUser', () => {
  let wallet: Wallet | null;
  let credential: PasskeyCredential | null;
  let service: WalletsService;

  const walletRepo: Partial<IWalletRepository> = {
    findEmbeddedWalletByUserId: () => Promise.resolve(wallet),
  };
  const credentialRepo: Partial<IPasskeyCredentialRepository> = {
    findByWalletId: () => Promise.resolve(credential),
  };

  beforeEach(() => {
    wallet = {
      id: 'wallet-1',
      userId: 'user-1',
      contractAddress: 'CWALLET',
      kind: 'embedded_passkey',
    } as Wallet;
    credential = {
      walletId: 'wallet-1',
      credentialId: 'cred-abc',
      transports: 'internal,hybrid',
      publicKey: Buffer.from([1, 2, 3]),
    } as PasskeyCredential;
    service = new WalletsService(
      walletRepo as IWalletRepository,
      credentialRepo as IPasskeyCredentialRepository,
      {} as UsersService,
      {} as DataSource,
      { record: () => Promise.resolve() } as unknown as AuditLogService,
    );
  });

  it('resolves the contract address + bound credential for the owner', async () => {
    const result = await service.resolveEmbeddedWalletForUser('user-1');
    expect(result).toEqual({
      contractAddress: 'CWALLET',
      credential: { credentialId: 'cred-abc', transports: 'internal,hybrid', publicKey: Buffer.from([1, 2, 3]) },
    });
  });

  it('throws when the caller has no embedded wallet', async () => {
    wallet = null;
    await expect(service.resolveEmbeddedWalletForUser('user-1')).rejects.toBeInstanceOf(
      EmbeddedWalletNotFoundError,
    );
  });

  it('throws when the wallet has no contract address (data anomaly)', async () => {
    wallet = { id: 'wallet-1', userId: 'user-1', contractAddress: null, kind: 'embedded_passkey' } as Wallet;
    await expect(service.resolveEmbeddedWalletForUser('user-1')).rejects.toBeInstanceOf(
      EmbeddedWalletNotFoundError,
    );
  });

  it('throws when the bound credential is missing (data anomaly)', async () => {
    credential = null;
    await expect(service.resolveEmbeddedWalletForUser('user-1')).rejects.toBeInstanceOf(
      EmbeddedWalletNotFoundError,
    );
  });
});
