import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PreviouslyKnownAs from '@/components/profile/PreviouslyKnownAs';

describe('PreviouslyKnownAs', () => {
  it('renders nothing when there are no previous handles', () => {
    const { container } = render(<PreviouslyKnownAs handles={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a single handle with no expander', () => {
    render(<PreviouslyKnownAs handles={['earlyname']} />);
    expect(screen.getByText(/previously known as/)).toBeInTheDocument();
    expect(screen.getByText('@earlyname')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders exactly two handles inline with no expander', () => {
    render(<PreviouslyKnownAs handles={['one', 'two']} />);
    expect(screen.getByText('@one')).toBeVisible();
    expect(screen.getByText('@two')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('collapses the tail behind a "+N more" button when there are more than two', () => {
    render(<PreviouslyKnownAs handles={['one', 'two', 'three', 'four', 'five']} />);
    const button = screen.getByRole('button', { name: /show 3 more previous handles/i });
    expect(button).toHaveTextContent('+3 more');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('@one')).toBeVisible();
    expect(screen.getByText('@two')).toBeVisible();
    // the tail is present in the DOM (progressive enhancement) but hidden while collapsed
    expect(screen.getByText('@three')).toBeInTheDocument();
    expect(screen.getByText('@three')).not.toBeVisible();
  });

  it('reveals and re-hides the tail on toggle, flipping aria-expanded', async () => {
    const user = userEvent.setup();
    render(<PreviouslyKnownAs handles={['one', 'two', 'three']} />);
    const button = screen.getByRole('button');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveTextContent('show less');
    expect(screen.getByText('@three')).toBeVisible();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('@three')).not.toBeVisible();
  });

  it('renders handles as plain text, never links', () => {
    render(<PreviouslyKnownAs handles={['one', 'two', 'three']} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('escapes handle content — script-like text renders inert', () => {
    render(<PreviouslyKnownAs handles={['<img src=x>']} />);
    expect(screen.getByText('@<img src=x>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
