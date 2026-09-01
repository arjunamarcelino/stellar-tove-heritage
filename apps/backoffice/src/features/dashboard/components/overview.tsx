'use client';

import { Activity, Rocket, Users } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { OfferingCountdownCard } from '@/features/offerings/components/offering-countdown-card';

import { formatNumber } from '../format';
import { useDashboardSummary } from '../hooks/use-dashboard-queries';
import { StatCard } from './stat-card';

const skeletonCards = (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 3 }).map((_, i) => (
      <Skeleton key={i} className="h-32" />
    ))}
  </div>
);

export function Overview() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { data, isLoading, isError } = useDashboardSummary();

  if (isAuthLoading || isLoading) {
    return skeletonCards;
  }

  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
    return (
      <div className="rounded-md border p-6">
        <h2 className="text-lg font-semibold">Welcome to Tove Backoffice</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the Tove fractionalized art tokenization platform.
        </p>
      </div>
    );
  }

  const formatValue = (value: number | undefined) =>
    isError || value == null ? '—' : formatNumber(value);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Total Users" value={formatValue(data?.totalUsers)} icon={Users} />
        <StatCard title="Total Missions" value={formatValue(data?.totalMissions)} icon={Rocket} />
        <StatCard
          title="Active Missions"
          value={formatValue(data?.activeMissions)}
          icon={Activity}
        />
      </div>
      <OfferingCountdownCard />
    </div>
  );
}
