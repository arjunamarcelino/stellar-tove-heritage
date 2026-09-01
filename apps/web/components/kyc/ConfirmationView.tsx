'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { KYC_SLA_COPY } from '@/lib/kyc/constants';
import { KYC_PRIMARY_BUTTON } from '@/components/kyc/constants';

interface Props {
  statusHref: Route;
}

// Body-only post-submit screen (the wizard owns the heading). Static SLA copy + a link to the status
// surface (FR-01.08). The backend returns no SLA field, so the copy is a curated constant.
export default function ConfirmationView({ statusHref }: Props) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-charcoal/70">
        Thanks — we’ve received your documents. {KYC_SLA_COPY}
      </p>
      <Link href={statusHref} className={KYC_PRIMARY_BUTTON}>
        Check your status
      </Link>
    </div>
  );
}
