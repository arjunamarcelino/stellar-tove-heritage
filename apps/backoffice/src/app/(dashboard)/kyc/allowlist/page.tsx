import type { Metadata } from 'next';

import { PageHeader } from '@/components/shared/page-header';
import { AllowlistManager } from '@/features/kyc-allowlist/components/allowlist-manager';

export const metadata: Metadata = {
  title: 'KYC Allowlist — Tove Backoffice',
};

export default function KycAllowlistPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="KYC Allowlist"
        description="Manage on-chain allowlist status for Collector wallets"
      />
      <AllowlistManager />
    </div>
  );
}
