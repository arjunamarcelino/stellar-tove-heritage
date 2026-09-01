import type { Stage } from './schemas';

export type StageStatus = 'active' | 'scheduled' | 'inactive';

export function getStageStatus(stage: Stage): StageStatus {
  if (!stage.isActive) return 'inactive';
  if (stage.startsAt && new Date(stage.startsAt) > new Date()) return 'scheduled';
  return 'active';
}

export const stageStatusVariant: Record<StageStatus, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  scheduled: 'secondary',
  inactive: 'outline',
};

export const stageStatusLabel: Record<StageStatus, string> = {
  active: 'Active',
  scheduled: 'Scheduled',
  inactive: 'Inactive',
};
