import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SocialLinksFields from '@/components/profile/SocialLinksFields';

const EMPTY = { twitter: '', instagram: '', website: '' };

describe('SocialLinksFields', () => {
  it('renders three labeled inputs', () => {
    render(<SocialLinksFields values={EMPTY} errors={{}} onChange={vi.fn()} />);
    expect(screen.getByLabelText('X (Twitter)')).toBeInTheDocument();
    expect(screen.getByLabelText('Instagram')).toBeInTheDocument();
    expect(screen.getByLabelText('Website')).toBeInTheDocument();
  });

  it('previews the built URL for a valid X handle', () => {
    render(
      <SocialLinksFields
        values={{ ...EMPTY, twitter: 'leonardo' }}
        errors={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('https://x.com/leonardo')).toBeInTheDocument();
  });

  it('previews the built URL for a valid Instagram handle', () => {
    render(
      <SocialLinksFields
        values={{ ...EMPTY, instagram: 'davinci' }}
        errors={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('https://instagram.com/davinci')).toBeInTheDocument();
  });

  it('shows the parse error as the preview for a non-empty invalid handle', () => {
    render(
      <SocialLinksFields
        values={{ ...EMPTY, twitter: '!!bad!!' }}
        errors={{}}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Use letters, numbers/i)).toBeInTheDocument();
  });

  it('shows no preview when a handle field is empty', () => {
    render(<SocialLinksFields values={EMPTY} errors={{}} onChange={vi.fn()} />);
    expect(screen.queryByText(/x\.com|instagram\.com/)).toBeNull();
  });

  it('calls onChange with the field key and value on input', () => {
    const onChange = vi.fn();
    render(<SocialLinksFields values={EMPTY} errors={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('X (Twitter)'), { target: { value: 'newhandle' } });
    expect(onChange).toHaveBeenCalledWith('twitter', 'newhandle');
  });

  it('renders a per-field error with aria-invalid, role=alert and aria-describedby', () => {
    render(
      <SocialLinksFields
        values={{ ...EMPTY, twitter: 'leonardo' }}
        errors={{ 'socialLinks.twitter': 'Enter a valid X (Twitter) handle or profile URL.' }}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('X (Twitter)');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter a valid X (Twitter) handle or profile URL.');
    // aria-describedby wires both the preview and the error (valid handle + error present).
    expect(input.getAttribute('aria-describedby')).toContain('profile-twitter-error');
    expect(input.getAttribute('aria-describedby')).toContain('profile-twitter-preview');
  });

  it('renders the website field error keyed by socialLinks.website', () => {
    render(
      <SocialLinksFields
        values={{ ...EMPTY, website: 'notaurl' }}
        errors={{ 'socialLinks.website': 'Enter a valid https website URL.' }}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Website');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid https website URL.');
  });
});
