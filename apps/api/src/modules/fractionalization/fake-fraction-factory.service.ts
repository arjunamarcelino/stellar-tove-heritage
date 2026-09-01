import { Injectable } from '@nestjs/common';
import {
  DeployFractionTokenInput,
  DeployFractionTokenResult,
  IFractionFactoryService,
} from './fraction-factory.service.interface';
import { deriveFractionTokenAddress } from './soroban-fraction-factory.service';

/**
 * Deterministic in-memory factory service for e2e/integration suites (no RPC, no signing). Returns the
 * off-chain-derived token address and remembers deployments so `tokenOf` self-heal is exercisable.
 */
@Injectable()
export class FakeFractionFactoryService implements IFractionFactoryService {
  private readonly deployed = new Map<string, string>();
  private readonly factoryAddress = 'CAZOVWDKGNPMSF7GJ3FKW7M7WGTQDUKDGC3VNVSN4TQYCXBHT53LHEZC';
  private readonly passphrase = 'Test SDF Network ; September 2015';

  tokenOf(artworkId: string): Promise<string | null> {
    return Promise.resolve(this.deployed.get(artworkId) ?? null);
  }

  async deployFractionToken(input: DeployFractionTokenInput): Promise<DeployFractionTokenResult> {
    const address = deriveFractionTokenAddress(this.factoryAddress, input.artworkId, this.passphrase);
    const txHash = 'ab'.repeat(32);
    if (input.onTxHash) await input.onTxHash(txHash);
    this.deployed.set(input.artworkId, address);
    return { tokenAddress: address, txHash, deployLedger: '1000' };
  }
}
