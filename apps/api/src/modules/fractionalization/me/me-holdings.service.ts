import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { failHttp } from '@common/http/fail-http';
import { ErrorCode } from '@common/enums/error-code.enum';
import { fractionReadConfig } from '@config/fraction-read.config';
import { WalletsService } from '@modules/wallets/wallets.service';
import {
  ARTWORK_REPOSITORY,
  IArtworkRepository,
} from '../repositories/artwork-repository.interface';
import {
  FRACTION_CONTRACT_REPOSITORY,
  IFractionContractRepository,
} from '../repositories/fraction-contract-repository.interface';
import { Artwork } from '../entities/artwork.entity';
import { FractionContract } from '../entities/fraction-contract.entity';
import { HoldingDto } from './dto/holding.dto';
import { HoldingsCache } from './holdings-cache';
import {
  FRACTION_READ_SERVICE,
  IFractionReadService,
} from '../fraction-read.service.interface';
import { FractionReadUnavailableError } from '../fraction-read.errors';
import { parseAmount } from '../amount';

const MS_PER_DAY = 86_400_000;

/** A deployed contract guaranteed (by the type-predicate filter) to have a non-null token address. */
type DeployedContract = FractionContract & { tokenAddress: string };

/**
 * Aggregates a collector's fraction holdings (TOV-237). Resolves the caller's primary settlement wallet,
 * reads `FractionToken.balance(wallet)` for every deployed contract in bounded parallel, derives the
 * artist lockup, and returns non-zero holdings. 30s per-wallet cache; complete-or-nothing on read failure.
 */
@Injectable()
export class MeHoldingsService {
  private readonly logger = new Logger(MeHoldingsService.name);

  /**
   * Per-wallet single-flight (todo 248): coalesces concurrent cache-miss requests for the same wallet
   * (e.g. multiple tabs at TTL expiry) into ONE fan-out within this instance, instead of each firing the
   * full O(catalog) read. Bounded because holdings are owner-scoped by JWT `sub`, so a hot key is only
   * ever the caller's own concurrent requests. Entries are deleted in `finally`, so this never caches.
   */
  private readonly inFlight = new Map<string, Promise<HoldingDto[]>>();

  constructor(
    private readonly walletsService: WalletsService,
    @Inject(FRACTION_CONTRACT_REPOSITORY)
    private readonly contracts: IFractionContractRepository,
    @Inject(ARTWORK_REPOSITORY) private readonly artworks: IArtworkRepository,
    @Inject(FRACTION_READ_SERVICE) private readonly reader: IFractionReadService,
    private readonly cache: HoldingsCache,
    @Inject(fractionReadConfig.KEY) private readonly cfg: ConfigType<typeof fractionReadConfig>,
  ) {}

  async listHoldings(userId: string): Promise<HoldingDto[]> {
    const wallet = await this.walletsService.resolvePrimarySettlementAddress(userId);
    if (!wallet) return [];

    const cached = await this.cache.get(wallet);
    if (cached) return cached;

    // Single-flight the expensive read: concurrent same-wallet misses share one fan-out. No `await`
    // between get() and set() below, so the check-and-set is atomic on the single-threaded event loop.
    const existing = this.inFlight.get(wallet);
    if (existing) return existing;
    const run = this.loadAndCache(wallet).finally(() => this.inFlight.delete(wallet));
    this.inFlight.set(wallet, run);
    return run;
  }

  private async loadAndCache(wallet: string): Promise<HoldingDto[]> {
    const deployed = (await this.contracts.findAllDeployed()).filter(
      (c): c is DeployedContract => c.tokenAddress !== null,
    );
    if (deployed.length === 0) {
      await this.cache.set(wallet, []);
      return [];
    }
    if (deployed.length >= this.cfg.fanOutWarnThreshold) {
      // Warn-only (fan-out is O(catalog) and never truncated): surface the approaching cliff so it's
      // observed before it hurts (Open Q#2 / todo 247). This does NOT cap the read.
      this.logger.warn(
        `holdings read fan-out at ${deployed.length} deployed contracts ` +
          `(warn threshold ${this.cfg.fanOutWarnThreshold})`,
      );
    }

    let holdings: HoldingDto[];
    try {
      holdings = await this.buildHoldings(wallet, deployed);
    } catch (err) {
      if (err instanceof FractionReadUnavailableError) {
        this.logger.warn(`holdings read unavailable for wallet: ${String(err)}`);
        throw failHttp(
          ErrorCode.HOLDINGS_UNAVAILABLE,
          HttpStatus.SERVICE_UNAVAILABLE,
          'Holdings are temporarily unavailable',
        );
      }
      throw err;
    }

    await this.cache.set(wallet, holdings);
    return holdings;
  }

  private async buildHoldings(
    wallet: string,
    deployed: DeployedContract[],
  ): Promise<HoldingDto[]> {
    const tokenContracts = deployed.map((c) => c.tokenAddress);
    const balances = await this.reader.balancesOf(tokenContracts, wallet);

    const artworkIds = [...new Set(deployed.map((c) => c.artworkId))];
    const artworkById = new Map<string, Artwork>(
      (await this.artworks.findByIds(artworkIds)).map((a) => [a.id, a]),
    );

    const now = Date.now();
    const rows: HoldingDto[] = [];
    for (const contract of deployed) {
      const balance = parseAmount(balances.get(contract.tokenAddress), 'balance', { nonNegative: true });
      if (balance === 0n) continue; // return only actual holdings

      const artwork = artworkById.get(contract.artworkId);
      if (!artwork) continue; // orphan contract without a live artwork — skip defensively

      const locked = this.artistLockedAmount(contract, wallet, balance, now);
      const free = balance - locked < 0n ? 0n : balance - locked; // free is never negative
      rows.push(
        HoldingDto.fromRow({
          artworkId: artwork.id,
          artworkTitle: artwork.title,
          artworkImageUrl: artwork.primaryImageUrl,
          tokenContract: contract.tokenAddress,
          artistHandle: artwork.artistHandle,
          balance: balance.toString(),
          lockedBalance: locked.toString(),
          freeBalance: free.toString(),
        }),
      );
    }
    return rows;
  }

  /**
   * Locked amount for the caller on one contract. Non-zero ONLY for the artist's own retained position
   * while the lockup window is open: `now < createdAt + artistLockupDays`. Collectors (and the artist
   * after expiry) get `0`. Treasury lockup is deferred (no bearer-auth treasury caller).
   *
   * DISPLAY-ONLY (todo 244): the FractionToken enforces the REAL lockup on-chain at transfer time. This is
   * anchored on `created_at` (the fractionalize REQUEST time), which precedes the on-chain deploy time by
   * the settlement window — so the displayed unlock instant may drift slightly from the enforced one, and
   * the boundary is fail-open (`now >= end` → unlocked). That is safe here because this value NEVER
   * authorizes a transfer; any Sell settlement must re-read the balance on-chain. Do NOT reuse this
   * computation to gate a write path without switching to a deploy-time anchor.
   */
  private artistLockedAmount(
    contract: FractionContract,
    wallet: string,
    balance: bigint,
    now: number,
  ): bigint {
    if (wallet !== contract.artistAddress) return 0n;
    const lockupEndMs = contract.createdAt.getTime() + contract.artistLockupDays * MS_PER_DAY;
    if (now >= lockupEndMs) return 0n; // inclusive end: released AT createdAt + lockupDays
    const retention = parseAmount(contract.artistRetentionAmount ?? '0', 'artistRetentionAmount');
    return balance < retention ? balance : retention; // locked is capped at the actual balance
  }
}
