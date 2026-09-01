import { z } from 'zod';

export const dashboardStatsSchema = z.object({
  totalUsers: z.number(),
  totalMissions: z.number(),
  activeMissions: z.number(),
});

export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

export const dashboardMissionStatsSchema = z.object({
  missionId: z.string().min(1),
  missionTitle: z.string(),
  stageTitle: z.string(),
  totalUsers: z.number(),
  pending: z.number(),
  accepted: z.number(),
  rejected: z.number(),
});

export const dashboardMissionStatsListSchema = z.array(dashboardMissionStatsSchema);

export type DashboardMissionStats = z.infer<typeof dashboardMissionStatsSchema>;
