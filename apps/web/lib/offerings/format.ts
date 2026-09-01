// Money/amount helpers were promoted to the feature-neutral lib/money/format.ts (TOV-173) so non-offering
// surfaces can share them without importing the offering namespace. Re-exported here so existing offering
// imports (services, components, useCountdown) keep their path unchanged.
export {
  escrowAmount,
  usdcToStroops,
  stroopsToUsdc,
  formatUsdc,
  clampToBand,
  isWithinBand,
  countdownParts,
} from '@/lib/money/format';
