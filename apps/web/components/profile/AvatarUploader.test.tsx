import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Avatar renders next/image; mock it so the uploader test doesn't depend on the optimizer.
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test mock stands in for next/image
    <img src={src} alt={alt} data-testid="avatar-img" />
  ),
}));

import AvatarUploader from '@/components/profile/AvatarUploader';
import type { AvatarUploadState, ProfileImageUrls } from '@/lib/types/api';

const IMG: ProfileImageUrls = {
  thumbUrl: 'https://cdn.test/t.webp',
  cardUrl: 'https://cdn.test/c.webp',
  heroUrl: 'https://cdn.test/h.webp',
};

function setup(overrides: Partial<React.ComponentProps<typeof AvatarUploader>> = {}) {
  const onSelectFile = vi.fn();
  const onRemove = vi.fn();
  const onRetry = vi.fn();
  render(
    <AvatarUploader
      state={{ status: 'idle' } as AvatarUploadState}
      previewUrl={null}
      activeImage={null}
      name="Ada Lovelace"
      onSelectFile={onSelectFile}
      onRemove={onRemove}
      onRetry={onRetry}
      {...overrides}
    />,
  );
  return { onSelectFile, onRemove, onRetry };
}

describe('AvatarUploader', () => {
  it('forwards a picked file to onSelectFile', () => {
    const { onSelectFile } = setup();
    const input = screen.getByLabelText(/upload a photo/i);
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelectFile).toHaveBeenCalledWith(file);
  });

  it('resets the input value so the same file can be re-picked (#219)', () => {
    const { onSelectFile } = setup();
    const input = screen.getByLabelText(/upload a photo/i) as HTMLInputElement;
    const file = new File(['x'], 'p.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    // After handoff the input is cleared, so a repeat selection of the identical file still fires.
    expect(input.value).toBe('');
  });

  it('shows Remove when there is an avatar and calls onRemove', () => {
    const { onRemove } = setup({ activeImage: IMG });
    fireEvent.click(screen.getByRole('button', { name: /remove photo/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('does not show Remove when there is no avatar', () => {
    setup();
    expect(screen.queryByRole('button', { name: /remove photo/i })).not.toBeInTheDocument();
  });

  it('renders both a polite status region and an assertive alert region', () => {
    setup({ state: { status: 'processing', attempts: 2 } });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/processing your photo/i);
    expect(screen.getByRole('alert')).toBeInTheDocument(); // present-but-empty
  });

  it('offers Check again in the timedOut state and calls onRetry', () => {
    const { onRetry } = setup({
      state: { status: 'timedOut', attempts: 20 },
      previewUrl: 'blob:x',
    });
    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the failure copy in an alert with a Start over affordance', () => {
    const { onRetry } = setup({ state: { status: 'failed', reason: 'processing' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t process that photo/i);
    fireEvent.click(screen.getByRole('button', { name: /start over/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an error state message in the alert region', () => {
    setup({
      state: {
        status: 'error',
        phase: 'commit',
        code: 'PROFILE_IMAGE_INVALID',
        message: 'That file could not be processed.',
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('That file could not be processed.');
  });
});
