// Neutral, feature-agnostic typography tokens (promoted out of components/offering/constants.ts so non-offering
// money surfaces — e.g. the RFQ create panel, TOV-173 — don't depend on the offering namespace, mirroring the
// button/surface promotions in components/ui/buttons.ts and surfaces.ts).

// Every money/time figure: Lora display + tabular-nums so digits are fixed-width and don't reflow as they tick,
// in the ink tone (umber).
export const MONEY_FIGURE = 'font-heading tabular-nums text-umber';
