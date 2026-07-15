import { describe, it, expect, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { relayerConfig } from '../../../../../src/config/relayer.config';
import { webauthnConfig } from '../../../../../src/config/webauthn.config';
import { ErrorCode } from '../../../../../src/common/enums/error-code.enum';
import { WalletTransferService } from '../../../../../src/modules/wallets/transfer/wallet-transfer.service';
import { WalletsService } from '../../../../../src/modules/wallets/wallets.service';
import { EmbeddedWalletNotFoundError } from '../../../../../src/modules/wallets/embedded-wallet-not-found.error';
import { RelayerTransferError } from '../../../../../src/modules/relayer/relayer.errors';
import { IRelayerService } from '../../../../../src/modules/relayer/relayer.service.interface';
import { FakeRelayerService } from '../../../../shared/fake-relayer';
import { createSoftwarePasskey } from '../../../../shared/webauthn-authenticator';

const errorCodeOf = (err: unknown): { status: number; errorCode: ErrorCode } => {
  expect(err).toBeInstanceOf(HttpException);
  const e = err as HttpException;
  return { status: e.getStatus(), errorCode: (e.getResponse() as { errorCode: ErrorCode }).errorCode };
};

describe('WalletTransferService.build', () => {
  const cfg = {
    usdcTokenAddress: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    maxTransferAmount: '1000000000000', // 100k USDC at 7dp
  } as ConfigType<typeof relayerConfig>;
  const webauthn = { rpId: 'tove.io' } as ConfigType<typeof webauthnConfig>;

  let relayer: FakeRelayerService;
  let resolution: Awaited<ReturnType<WalletsService['resolveEmbeddedWalletForUser']>>;
  let resolveError: Error | null;
  let service: WalletTransferService;

  const walletsService = {
    resolveEmbeddedWalletForUser: () =>
      resolveError ? Promise.reject(resolveError) : Promise.resolve(resolution),
  } as unknown as WalletsService;

  beforeEach(() => {
    relayer = new FakeRelayerService();
    resolveError = null;
    resolution = {
      contractAddress: 'CAZOVWDKGNPMSF7GJ3FKW7M7WGTQDUKDGC3VNVSN4TQYCXBHT53LHEZC',
      credential: { credentialId: 'cred-abc', transports: 'internal', publicKey: Buffer.from([1]) },
    };
    service = new WalletTransferService(cfg, webauthn, relayer, walletsService);
  });

  it('builds a transfer for the authenticated owner and echoes the scaled amount', async () => {
    const dto = { to: 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI', amount: '10.5' };
    const res = await service.build('user-1', dto);

    expect(res.amountScaled).toBe('105000000'); // 10.5 * 1e7
    expect(res.credentialId).toBe('cred-abc');
    expect(res.transports).toBe('internal');
    expect(res.rpId).toBe('tove.io');
    expect(res.to).toBe(dto.to);
    expect(res.challenge.length).toBeGreaterThan(0);
    // The relayer was asked to build a transfer FROM the resolved wallet (owner-scoped).
    expect(relayer.buildCalls[0]).toMatchObject({
      walletContract: resolution.contractAddress,
      tokenContract: cfg.usdcTokenAddress,
      to: dto.to,
      amountScaled: '105000000',
    });
  });

  it('returns WALLET_NOT_FOUND when the caller has no embedded wallet', async () => {
    resolveError = new EmbeddedWalletNotFoundError('user-1');
    try {
      await service.build('user-1', { to: 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI', amount: '1' });
      expect.unreachable();
    } catch (err) {
      const { status, errorCode } = errorCodeOf(err);
      expect(status).toBe(HttpStatus.NOT_FOUND);
      expect(errorCode).toBe(ErrorCode.WALLET_NOT_FOUND);
    }
    expect(relayer.buildCalls).toHaveLength(0); // never reached the relayer
  });

  it('rejects an amount over the configured ceiling', async () => {
    try {
      await service.build('user-1', { to: 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI', amount: '200000' }); // 2e12 > 1e12
      expect.unreachable();
    } catch (err) {
      const { status, errorCode } = errorCodeOf(err);
      expect(status).toBe(HttpStatus.BAD_REQUEST);
      expect(errorCode).toBe(ErrorCode.VALIDATION_FAILED);
    }
    expect(relayer.buildCalls).toHaveLength(0);
  });

  it('rejects an amount with too many fractional digits', async () => {
    try {
      await service.build('user-1', { to: 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI', amount: '1.00000001' });
      expect.unreachable();
    } catch (err) {
      expect(errorCodeOf(err).errorCode).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  it('maps a relayer simulation failure to TRANSFER_SIMULATION_FAILED', async () => {
    relayer.failNextBuild();
    try {
      await service.build('user-1', { to: 'CDL5YRUNMPGJ42KQFDEKTJBTVBAQGKAGQRJ44DRFBJSMZMBBTACGAQYI', amount: '1' });
      expect.unreachable();
    } catch (err) {
      const { status, errorCode } = errorCodeOf(err);
      expect(status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(errorCode).toBe(ErrorCode.TRANSFER_SIMULATION_FAILED);
    }
  });

  describe('submit', () => {
    const dto = { txXdr: 'AAAA', authenticatorData: 'AAAA', clientDataJSON: 'AAAA', signature: 'AAAA' };

    it('maps a relayer signature_invalid to TRANSFER_SIGNATURE_INVALID', async () => {
      // A valid COSE key so the pre-relayer decode succeeds; a stub relayer throws the refusal.
      resolution = {
        contractAddress: resolution.contractAddress,
        credential: { credentialId: 'cred', transports: null, publicKey: Buffer.from(createSoftwarePasskey().cosePublicKey) },
      };
      const stubRelayer = {
        submitSignedTransfer: () => Promise.reject(new RelayerTransferError('signature_invalid')),
      } as unknown as IRelayerService;
      const svc = new WalletTransferService(cfg, webauthn, stubRelayer, walletsService);
      try {
        await svc.submit('user-1', dto);
        expect.unreachable();
      } catch (err) {
        const { status, errorCode } = errorCodeOf(err);
        expect(status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        expect(errorCode).toBe(ErrorCode.TRANSFER_SIGNATURE_INVALID);
      }
    });

    it('returns WALLET_NOT_FOUND when the caller has no embedded wallet', async () => {
      resolveError = new EmbeddedWalletNotFoundError('user-1');
      try {
        await service.submit('user-1', dto);
        expect.unreachable();
      } catch (err) {
        expect(errorCodeOf(err).errorCode).toBe(ErrorCode.WALLET_NOT_FOUND);
      }
    });
  });
});
