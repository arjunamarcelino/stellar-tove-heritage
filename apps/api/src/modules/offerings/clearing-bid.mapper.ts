import { OfferingBid } from './entities/offering-bid.entity';
import { ClearingBidInput } from './clearing';

/**
 * Map an `escrowed` bid row to the pure clearing-algorithm input (TOV-160). Shared by the settle worker and
 * the backoffice clearing preview so both compute over the identical shape. An `escrowed` bid always carries
 * `chain_bid_id` (`CHK_bid_escrowed_stamped`); a null is a data fault (throws).
 */
export function toClearingInput(bid: OfferingBid): ClearingBidInput {
  if (bid.chainBidId == null) {
    throw new Error(`escrowed bid ${bid.id} has no chain_bid_id`);
  }
  return {
    id: bid.id,
    chainBidId: bid.chainBidId,
    collectorSub: bid.collectorSub,
    priceStroops: bid.priceStroops,
    count: bid.count,
    createdAt: bid.createdAt.toISOString(),
    escrowAmountStroops: bid.escrowAmountStroops,
  };
}
