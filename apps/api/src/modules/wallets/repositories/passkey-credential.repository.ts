import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseRepository } from '@common/repositories/base.repository';
import { PasskeyCredential } from '../entities/passkey-credential.entity';
import { IPasskeyCredentialRepository } from './passkey-credential-repository.interface';

@Injectable()
export class PasskeyCredentialRepository
  extends BaseRepository<PasskeyCredential>
  implements IPasskeyCredentialRepository
{
  constructor(dataSource: DataSource) {
    super(PasskeyCredential, dataSource);
  }

  async findByCredentialId(credentialId: string): Promise<PasskeyCredential | null> {
    // Load wallet + user so an idempotent-replay of a completed registration can
    // match the email. Active rows only (soft-deleted credentials excluded).
    return this.repository.findOne({
      where: { credentialId },
      relations: { wallet: { user: true } },
    });
  }

  async findByWalletId(walletId: string): Promise<PasskeyCredential | null> {
    return this.repository.findOne({ where: { walletId } });
  }

  async updateCounter(credentialId: string, counter: number): Promise<void> {
    await this.repository.update({ credentialId }, { counter });
  }
}
