import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  getCollectorByHandle: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

// Stub only getCollectorByHandle; keep the rest of the service module real.
vi.mock('@/lib/services/collectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/collectors')>();
  return { ...actual, getCollectorByHandle: h.getCollectorByHandle };
});
vi.mock('next/navigation', () => ({ notFound: h.notFound }));

// CollectorProfileLoadError is colocated with the page that throws it (todo 110).
import CollectorProfilePage, {
  generateMetadata,
  CollectorProfileLoadError,
} from '@/app/(public)/c/[handle]/page';
import { SITE_CONFIG } from '@/lib/constants';

function paramsFor(handle: string) {
  return { params: Promise.resolve({ handle }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CollectorProfilePage', () => {
  it('renders the handle heading and the previously-known-as line on success with history', async () => {
    h.getCollectorByHandle.mockResolvedValue({
      status: 'success',
      profile: { handle: 'newname', previousHandles: ['earlyname'] },
    });
    render(await CollectorProfilePage(paramsFor('newname')));
    expect(screen.getByRole('heading', { name: '@newname' })).toBeInTheDocument();
    expect(screen.getByText('@earlyname')).toBeVisible();
  });

  it('renders the heading but no previously-known-as line when there is no history', async () => {
    h.getCollectorByHandle.mockResolvedValue({
      status: 'success',
      profile: { handle: 'newname', previousHandles: [] },
    });
    render(await CollectorProfilePage(paramsFor('newname')));
    expect(screen.getByRole('heading', { name: '@newname' })).toBeInTheDocument();
    expect(screen.queryByText(/previously known as/)).toBeNull();
  });

  it('calls notFound() when the collector does not resolve', async () => {
    h.getCollectorByHandle.mockResolvedValue({ status: 'not_found' });
    await expect(CollectorProfilePage(paramsFor('ghost'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(h.notFound).toHaveBeenCalledTimes(1);
  });

  it('throws CollectorProfileLoadError on a transient error', async () => {
    h.getCollectorByHandle.mockResolvedValue({ status: 'error' });
    await expect(CollectorProfilePage(paramsFor('newname'))).rejects.toBeInstanceOf(
      CollectorProfileLoadError,
    );
  });

  it('CollectorProfileLoadError carries a static message and name', () => {
    const err = new CollectorProfileLoadError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CollectorProfileLoadError');
    expect(err.message).toBe('Failed to load collector profile');
  });

  it('marks the profile page noindex in its metadata', async () => {
    const meta = await generateMetadata(paramsFor('newname'));
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('does not reflect a malformed handle into the title (falls back to a generic title)', async () => {
    const meta = await generateMetadata(paramsFor('has space'));
    expect(meta.title).toBe(SITE_CONFIG.name);
    expect(meta.robots).toEqual({ index: false, follow: true });
  });
});
