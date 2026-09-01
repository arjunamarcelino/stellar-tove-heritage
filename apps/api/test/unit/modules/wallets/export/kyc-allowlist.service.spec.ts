import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KycAllowlistService } from '../../../../../src/modules/wallets/export/kyc-allowlist.service';

const G_ADDRESS = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

describe('KycAllowlistService', () => {
  let repo: { existsActive: ReturnType<typeof vi.fn> };
  let service: KycAllowlistService;

  beforeEach(() => {
    repo = { existsActive: vi.fn() };
    service = new KycAllowlistService(repo);
  });

  it('returns true when the canonical address is on the live allowlist', async () => {
    repo.existsActive.mockResolvedValue(true);
    await expect(service.isAllowed(G_ADDRESS)).resolves.toBe(true);
    expect(repo.existsActive).toHaveBeenCalledWith(G_ADDRESS);
  });

  it('returns false when the address is absent', async () => {
    repo.existsActive.mockResolvedValue(false);
    await expect(service.isAllowed(G_ADDRESS)).resolves.toBe(false);
  });

  it('canonicalizes before matching (whitespace-trimmed)', async () => {
    repo.existsActive.mockResolvedValue(true);
    await service.isAllowed(`  ${G_ADDRESS}  `);
    expect(repo.existsActive).toHaveBeenCalledWith(G_ADDRESS);
  });

  it('returns false (never throws) for a malformed target, without hitting the repo', async () => {
    await expect(service.isAllowed('not-an-address')).resolves.toBe(false);
    expect(repo.existsActive).not.toHaveBeenCalled();
  });
});
