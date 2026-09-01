import {
  CloseAndSettleInput,
  CloseAndSettleResult,
  CloseOfferingInput,
  DeployEscrowInput,
  DeployEscrowResult,
  IOfferingEscrowService,
  OfferingEscrowStatus,
} from '../../src/modules/offerings/escrow/offering-escrow.service.interface';
import {
  deriveOfferingEscrowAddress,
  escrowSalt,
} from '../../src/modules/offerings/escrow/offering-escrow-address';
import {
  OfferingEscrowError,
  OfferingEscrowThrottledError,
  OfferingSettleContractError,
} from '../../src/modules/offerings/escrow/offering-escrow.errors';

/** A fixed, valid testnet G-account the fake derives escrow addresses from (stable across runs). */
const FAKE_DEPLOYER = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** A recorded `close_and_settle` call (for assertion). */
export interface FakeSettleCall {
  offeringId: string;
  escrowAddress: string;
  clearingPrice: bigint;
  allocations: Array<{ bidId: number; allocated: bigint }>;
}

/**
 * Deterministic in-memory {@link IOfferingEscrowService} for unit + integration + e2e suites (no RPC,
 * no signing, no Redis). Extends the TOV-154 deploy fake with the TOV-160 settlement surface: an on-chain
 * status map (default `'open'`, mutated by `closeOffering`/`closeAndSettle`), recorded settle calls, and
 * per-offering forced failures. Mirrors the `FakeFractionFactoryService` pattern.
 */
export class FakeOfferingEscrowService implements IOfferingEscrowService {
  /** Every `deployEscrow` call, in order, for assertion. */
  readonly deployCalls: DeployEscrowInput[] = [];
  /** Every `close_and_settle` call, in order, for assertion. */
  readonly settleCalls: FakeSettleCall[] = [];
  /** Every `close_offering` call's offeringId, in order. */
  readonly closeCalls: string[] = [];
  /** offeringId → deployed escrow address (the self-heal memory). */
  private readonly deployed = new Map<string, string>();
  /** escrowAddress → on-chain lifecycle status (default 'open'). */
  private readonly statusByAddress = new Map<string, OfferingEscrowStatus>();

  /** offeringIds whose deploy should throw a terminal {@link OfferingEscrowError}. */
  failOn?: Set<string>;
  /** offeringIds whose deploy should throw a retryable {@link OfferingEscrowThrottledError}. */
  throttleOn?: Set<string>;
  /** offeringIds whose `close_and_settle` should throw a terminal {@link OfferingSettleContractError}. */
  settleFailOn?: Set<string>;
  /** offeringIds whose `close_and_settle` should throw a retryable {@link OfferingEscrowThrottledError}. */
  settleThrottleOn?: Set<string>;

  deployEscrow(input: DeployEscrowInput): Promise<DeployEscrowResult> {
    this.deployCalls.push(input);
    if (this.throttleOn?.has(input.offeringId)) {
      return Promise.reject(new OfferingEscrowThrottledError());
    }
    if (this.failOn?.has(input.offeringId)) {
      return Promise.reject(new OfferingEscrowError('forced', false));
    }
    const address = deriveOfferingEscrowAddress(
      FAKE_DEPLOYER,
      escrowSalt(input.offeringId),
      TESTNET_PASSPHRASE,
    );
    const isSelfHeal = this.deployed.has(input.offeringId);
    this.deployed.set(input.offeringId, address);
    this.statusByAddress.set(address, 'open');
    return Promise.resolve({ contractAddress: address, txHash: isSelfHeal ? null : 'ab'.repeat(32) });
  }

  readStatus(escrowAddress: string): Promise<OfferingEscrowStatus> {
    return Promise.resolve(this.statusByAddress.get(escrowAddress) ?? 'open');
  }

  closeOffering(input: CloseOfferingInput): Promise<{ txHash: string | null }> {
    this.closeCalls.push(input.offeringId);
    this.statusByAddress.set(input.escrowAddress, 'closed');
    return Promise.resolve({ txHash: 'cd'.repeat(32) });
  }

  closeAndSettle(input: CloseAndSettleInput): Promise<CloseAndSettleResult> {
    if (this.settleThrottleOn?.has(input.offeringId)) {
      return Promise.reject(new OfferingEscrowThrottledError('forced settle throttle'));
    }
    if (this.settleFailOn?.has(input.offeringId)) {
      return Promise.reject(new OfferingSettleContractError('forced settle failure', 8));
    }
    if ((this.statusByAddress.get(input.escrowAddress) ?? 'open') === 'settled') {
      return Promise.resolve({ txHash: null, ledger: null, alreadySettled: true });
    }
    this.settleCalls.push({
      offeringId: input.offeringId,
      escrowAddress: input.escrowAddress,
      clearingPrice: input.clearingPrice,
      allocations: input.allocations.map((a) => ({ bidId: a.bidId, allocated: a.allocated })),
    });
    this.statusByAddress.set(input.escrowAddress, 'settled');
    return Promise.resolve({ txHash: 'ef'.repeat(32), ledger: 12345, alreadySettled: false });
  }

  /** Test helper: pre-set an escrow's on-chain status (e.g. 'settled' to exercise the self-heal adopt path). */
  setStatus(escrowAddress: string, status: OfferingEscrowStatus): void {
    this.statusByAddress.set(escrowAddress, status);
  }

  /** Test helper: the deterministic escrow address the fake would deploy for an offering. */
  addressFor(offeringId: string): string {
    return deriveOfferingEscrowAddress(FAKE_DEPLOYER, escrowSalt(offeringId), TESTNET_PASSPHRASE);
  }

  reset(): void {
    this.deployCalls.length = 0;
    this.settleCalls.length = 0;
    this.closeCalls.length = 0;
    this.deployed.clear();
    this.statusByAddress.clear();
    this.failOn = undefined;
    this.throttleOn = undefined;
    this.settleFailOn = undefined;
    this.settleThrottleOn = undefined;
  }
}
