'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { KYC_SLA_COPY } from '@/lib/kyc/constants';
import { KYC_PRIMARY_BUTTON } from '@/components/kyc/constants';

export type KycStatusVariant = 'pending' | 'approved';

interface Props {
  variant: KycStatusVariant;
  statusHref: Route;
}

// One parameterized view for the terminal / gated states (replaces separate pending/approved/blocked
// components). Body-only when rendered inside the wizard; also used standalone by the page gate.
export default function KycStatusView({ variant, statusHref }: Props) {
  if (variant === 'approved') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-charcoal/70">
          Your identity is verified — there’s nothing more to do here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-charcoal/70">
        You already have a submission under review. {KYC_SLA_COPY}
      </p>
      <Link href={statusHref} className={KYC_PRIMARY_BUTTON}>
        Check your status
      </Link>
    </div>
  );
}
