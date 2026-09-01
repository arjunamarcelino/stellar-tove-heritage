import { api } from '@/lib/api-client';

import { dashboardMissionStatsListSchema, dashboardStatsSchema } from './schemas';

export async function getDashboardSummary() {
  const data = await api.get('/api/dashboard/summary');
  return dashboardStatsSchema.parse(data);
}

export async function getDashboardMissions() {
  const data = await api.get('/api/dashboard/missions');
  return dashboardMissionStatsListSchema.parse(data);
}
