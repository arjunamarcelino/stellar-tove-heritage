import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }));

vi.mock('next/navigation', () => ({ usePathname: usePathnameMock }));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import SettingsTabs from '@/components/settings/SettingsTabs';

describe('SettingsTabs', () => {
  it('marks Wallets current on the exact /settings root', () => {
    usePathnameMock.mockReturnValue('/settings');
    render(<SettingsTabs />);

    expect(screen.getByRole('link', { name: 'Wallets' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Profile' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Identity' })).not.toHaveAttribute('aria-current');
  });

  it('marks Profile current on /settings/profile — and NOT Wallets', () => {
    usePathnameMock.mockReturnValue('/settings/profile');
    render(<SettingsTabs />);

    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page');
    // The section root must not also light up under a nested route.
    expect(screen.getByRole('link', { name: 'Wallets' })).not.toHaveAttribute('aria-current');
  });

  it('marks Identity current on /settings/kyc', () => {
    usePathnameMock.mockReturnValue('/settings/kyc');
    render(<SettingsTabs />);

    expect(screen.getByRole('link', { name: 'Identity' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Wallets' })).not.toHaveAttribute('aria-current');
  });

  it('exposes the tab bar as a labelled navigation landmark', () => {
    usePathnameMock.mockReturnValue('/settings');
    render(<SettingsTabs />);

    expect(screen.getByRole('navigation', { name: 'Settings' })).toBeInTheDocument();
  });
});
