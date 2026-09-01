import { z } from 'zod';

// ── Money ────────────────────────────────────────────────────────────────────────────────────────
// i128 base-unit amounts arrive as decimal STRINGS and must never be coerced to a JS number (they can
// exceed 2^53). The brand marks a value as a validated money string (documentation / a nudge against
// mixing it with arbitrary strings). The REAL precision guard is the `/^\d+$/` regex: a bare JSON
// *number* fails `.parse()` loudly, since `res.json()` in the browser would already have truncated it
// before Zod runs. (Note: `formatStroops` accepts a plain `string`, so the brand is not a hard barrier.)
export const stroopsSchema = z
  .string()
  .regex(/^\d+$/, 'Must be a base-unit integer string')
  .brand<'Stroops'>();
export type Stroops = z.infer<typeof stroopsSchema>;

// ── Status ───────────────────────────────────────────────────────────────────────────────────────
// Offering lifecycle (backend). The offering stays `planned` until the async escrow deploy latches
// `approved`; deploy progress lives on `escrow.deployStatus`, NOT here.
export const offeringStatusSchema = z.enum([
  'planned',
  'approved',
  'opened',
  'subscribed',
  'settled',
  'canceled',
]);
export type OfferingStatus = z.infer<typeof offeringStatusSchema>;

// null until quorum; then deploying | deployed | failed.
export const escrowDeployStatusSchema = z.enum(['deploying', 'deployed', 'failed']).nullable();
export type EscrowDeployStatus = z.infer<typeof escrowDeployStatusSchema>;

// ── Escrow ───────────────────────────────────────────────────────────────────────────────────────
// List projection: deployStatus + contractAddress only.
export const escrowSummarySchema = z.object({
  deployStatus: escrowDeployStatusSchema,
  contractAddress: z.string().nullable(),
});
export type EscrowSummary = z.infer<typeof escrowSummarySchema>;

// Detail projection: adds deployLedger + approvedAt. DELIBERATELY has NO throwing `.refine` on the
// address: this is the poll target (hit every ~2s), and the backend may write `deployed` a beat before
// a valid address lands (eventual consistency). A refine here would blank the whole page on a transient
// body. Instead, `isDeployInFlight` keeps polling until the address is valid, and the render path gates
// the explorer link on `explorerContractUrl(...)` (returns null on a malformed address). See plan D-latch.
export const escrowDetailSchema = z.object({
  deployStatus: escrowDeployStatusSchema,
  contractAddress: z.string().nullable(),
  deployLedger: z.string().nullable(),
  approvedAt: z.string().nullable(),
});
export type EscrowDetail = z.infer<typeof escrowDetailSchema>;

// ── Approvals (asymmetric: list has youApproved, detail has signers) ───────────────────────────────
const approvalCountsSchema = {
  count: z.number().int().nonnegative(),
  threshold: z.number().int().positive(),
};

export const approvalsListSchema = z.object({
  ...approvalCountsSchema,
  youApproved: z.boolean(),
});
export type ApprovalsList = z.infer<typeof approvalsListSchema>;

// Aggregate-only (anti-collusion). The confirmed TOV-154 contract (2026-08-20 / backend PR #39) returns
// `youApproved` on the detail too and NO `signers[]`. Both kept optional for transition tolerance: an
// older deployed backend may still omit `youApproved` (→ CTA stays clickable) or include `signers[]`
// (→ stripped at the BFF, todo 094). The client consumes only count/threshold/youApproved.
export const approvalsDetailSchema = z.object({
  ...approvalCountsSchema,
  youApproved: z.boolean().optional(),
  signers: z.array(z.string()).optional(),
});
export type ApprovalsDetail = z.infer<typeof approvalsDetailSchema>;

// ── List item / detail ─────────────────────────────────────────────────────────────────────────
const offeringPayloadSchema = {
  lowPriceStroops: stroopsSchema,
  highPriceStroops: stroopsSchema,
  publicFloat: stroopsSchema,
  windowOpenAt: z.string(),
  windowCloseAt: z.string(),
};

export const offeringListItemSchema = z.object({
  id: z.string(),
  artworkId: z.string(),
  status: offeringStatusSchema,
  ...offeringPayloadSchema,
  attestedArtistAddress: z.string().nullable(),
  escrow: escrowSummarySchema,
  approvals: approvalsListSchema,
});
export type OfferingListItem = z.infer<typeof offeringListItemSchema>;

export const offeringDetailSchema = z.object({
  id: z.string(),
  artworkId: z.string(),
  status: offeringStatusSchema,
  ...offeringPayloadSchema,
  attestedArtistAddress: z.string().nullable(),
  escrow: escrowDetailSchema,
  approvals: approvalsDetailSchema,
});
export type OfferingDetail = z.infer<typeof offeringDetailSchema>;

// Paginated envelope — mirrors GET /artworks. `hasNextPage` is optional/lenient (some backends omit it;
// pagination is driven by `totalPages`). Zod strips unknown keys by default → additive fields are safe.
export const paginatedOfferingsSchema = z.object({
  data: z.array(offeringListItemSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
    hasNextPage: z.boolean().optional(),
  }),
});
export type PaginatedOfferings = z.infer<typeof paginatedOfferingsSchema>;

// ── Approve response ──────────────────────────────────────────────────────────────────────────────
// The request body is a fixed empty `{}` forwarded by the route handler (never client-validated), so no
// request schema is needed here.
// 202 body — carries youApproved AND signers. Escrow here is the summary shape (deployStatus +
// contractAddress). Lenient (extra keys stripped).
export const approveResponseSchema = z.object({
  offeringId: z.string(),
  status: offeringStatusSchema,
  approvals: z.object({
    ...approvalCountsSchema,
    youApproved: z.boolean(),
    signers: z.array(z.string()).optional(), // stripped at the BFF (todo 094)
  }),
  escrow: escrowSummarySchema,
});
export type ApproveResponse = z.infer<typeof approveResponseSchema>;
