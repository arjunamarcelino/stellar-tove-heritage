import { describe, it, expect, vi, beforeEach } from 'vitest';
import { offering, submittedBid, OFFERING_ID } from '@/test/fixtures/offerings';

// The page now reads the token via lib/cookies (server-only) — stub it so the module loads in the test.
vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  getActiveOffering: vi.fn(),
  getMyBid: vi.fn(),
  getWhitelistStatus: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/services/offerings', () => ({
  getActiveOffering: h.getActiveOffering,
  getMyBid: h.getMyBid,
}));
vi.mock('@/lib/services/kyc', () => ({ getWhitelistStatus: h.getWhitelistStatus }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
// Stub the client shells so OfferingSection returns elements whose `.props` we can inspect (and so their
// transitive 'use client' → server-only import chains don't load in the test).
vi.mock('@/components/offering/OfferingPage', () => ({ default: () => null }));
vi.mock('@/components/rfq/RfqSection', () => ({ default: () => null }));

import { OfferingSection, OfferingLoadError } from '@/app/(public)/artworks/[id]/offering/page';

const whitelisted = { status: 'success', data: { status: 'whitelisted', whitelistedAt: null } };

// OfferingSection now returns <div>{<OfferingPage/>}{<RfqSection/>}</div>; pull each child's props.
type El = { props: Record<string, unknown> };
function children(result: El): El[] {
  return result.props.children as El[];
}
const offeringProps = (result: El) => children(result)[0].props;
const rfqProps = (result: El) => children(result)[1].props;

beforeEach(() => {
  vi.clearAllMocks();
  h.getActiveOffering.mockResolvedValue({ status: 'success', offering });
  h.getWhitelistStatus.mockResolvedValue(whitelisted);
  h.getMyBid.mockResolvedValue({ status: 'success', bid: null });
});

describe('OfferingSection', () => {
  it('calls notFound() when no active offering exists', async () => {
    h.getActiveOffering.mockResolvedValue({
      status: 'error',
      code: 'OFFERING_NOT_FOUND',
      message: 'x',
    });
    await expect(OfferingSection({ id: OFFERING_ID, token: null })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(h.notFound).toHaveBeenCalled();
  });

  it('throws OfferingLoadError on a transient read (distinct from not-found)', async () => {
    h.getActiveOffering.mockResolvedValue({ status: 'error', code: 'SERVER_ERROR', message: 'x' });
    await expect(OfferingSection({ id: OFFERING_ID, token: null })).rejects.toBeInstanceOf(
      OfferingLoadError,
    );
    expect(h.notFound).not.toHaveBeenCalled();
  });

  it('anonymous → view-only props, no per-user reads', async () => {
    const result = (await OfferingSection({ id: OFFERING_ID, token: null })) as El;
    const props = offeringProps(result);
    expect(props.isSignedIn).toBe(false);
    expect(props.isWhitelisted).toBe(false);
    expect(props.initialBid).toBeNull();
    expect(props.offering).toBe(offering);
    expect(h.getWhitelistStatus).not.toHaveBeenCalled();
    expect(h.getMyBid).not.toHaveBeenCalled();
    // The RFQ section renders regardless of the offering window, gated view-only for an anon viewer.
    expect(rfqProps(result).isSignedIn).toBe(false);
    expect(rfqProps(result).artworkId).toBe(OFFERING_ID); // the validated route [id] (== artwork id)
  });

  it('signed-in whitelisted with an active bid → props reflect it', async () => {
    h.getMyBid.mockResolvedValue({ status: 'success', bid: submittedBid });
    const result = (await OfferingSection({ id: OFFERING_ID, token: 'tok' })) as El;
    const props = offeringProps(result);
    expect(props.isSignedIn).toBe(true);
    expect(props.isWhitelisted).toBe(true);
    expect(props.initialBid).toBe(submittedBid);
    expect(h.getMyBid).toHaveBeenCalledWith('tok', offering.id);
    // RFQ section receives the same computed gate state.
    expect(rfqProps(result).isSignedIn).toBe(true);
    expect(rfqProps(result).isWhitelisted).toBe(true);
  });

  it('stale token (SESSION_EXPIRED) → degrades to view-only, not a redirect', async () => {
    h.getWhitelistStatus.mockResolvedValue({
      status: 'error',
      code: 'SESSION_EXPIRED',
      message: 'x',
    });
    h.getMyBid.mockResolvedValue({ status: 'error', code: 'SESSION_EXPIRED', message: 'x' });
    const result = (await OfferingSection({ id: OFFERING_ID, token: 'stale' })) as El;
    const props = offeringProps(result);
    expect(props.isSignedIn).toBe(false);
    expect(props.isWhitelisted).toBe(false);
    expect(props.initialBid).toBeNull();
    expect(rfqProps(result).isSignedIn).toBe(false);
  });
});
