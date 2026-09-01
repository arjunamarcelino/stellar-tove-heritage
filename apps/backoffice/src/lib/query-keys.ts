import type {
  PaginationParams,
  MissionListParams,
  SubmissionFilterParams,
  ArtworkListParams,
  OfferingListParams,
} from '@/types/api';

export const authKeys = {
  me: ['auth', 'me'] as const,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
  missions: () => [...dashboardKeys.all, 'missions'] as const,
};

export const stageKeys = {
  all: ['stages'] as const,
  lists: () => [...stageKeys.all, 'list'] as const,
  list: (params: PaginationParams) => [...stageKeys.lists(), params] as const,
  details: () => [...stageKeys.all, 'detail'] as const,
  detail: (id: string) => [...stageKeys.details(), id] as const,
};

export const missionKeys = {
  all: ['missions'] as const,
  lists: () => [...missionKeys.all, 'list'] as const,
  listByStage: (stageId: string) => [...missionKeys.lists(), { stageId }] as const,
  list: (params: MissionListParams) => [...missionKeys.lists(), params] as const,
  details: () => [...missionKeys.all, 'detail'] as const,
  detail: (id: string) => [...missionKeys.details(), id] as const,
};

export const submissionKeys = {
  all: ['submissions'] as const,
  lists: () => [...submissionKeys.all, 'list'] as const,
  list: (params: SubmissionFilterParams) => [...submissionKeys.lists(), params] as const,
  details: () => [...submissionKeys.all, 'detail'] as const,
  detail: (id: string) => [...submissionKeys.details(), id] as const,
};

export const adminKeys = {
  all: ['admins'] as const,
  lists: () => [...adminKeys.all, 'list'] as const,
  list: (params: PaginationParams) => [...adminKeys.lists(), params] as const,
  details: () => [...adminKeys.all, 'detail'] as const,
  detail: (id: string) => [...adminKeys.details(), id] as const,
};

export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (params: PaginationParams) => [...userKeys.lists(), params] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
};

export const artworkKeys = {
  all: ['artworks'] as const,
  lists: () => [...artworkKeys.all, 'list'] as const,
  list: (params: ArtworkListParams) => [...artworkKeys.lists(), params] as const,
  details: () => [...artworkKeys.all, 'detail'] as const,
  detail: (id: string) => [...artworkKeys.details(), id] as const,
  // Deploy-status poll — keyed on artworkId only so it self-resumes on remount.
  fractionalization: (id: string) => [...artworkKeys.all, 'fractionalization', id] as const,
};

export const fileKeys = {
  all: ['files'] as const,
  lists: () => [...fileKeys.all, 'list'] as const,
  list: (params: PaginationParams) => [...fileKeys.lists(), params] as const,
  details: () => [...fileKeys.all, 'detail'] as const,
  detail: (id: string) => [...fileKeys.details(), id] as const,
};

export const allowlistKeys = {
  all: ['kyc-allowlist'] as const,
  // Per-wallet on-chain allowlist status (the pill). No list/detail layer — there is no list endpoint.
  status: (wallet: string) => [...allowlistKeys.all, 'status', wallet] as const,
};

export const offeringKeys = {
  all: ['offerings'] as const,
  lists: () => [...offeringKeys.all, 'list'] as const,
  list: (params: OfferingListParams) => [...offeringKeys.lists(), params] as const,
  details: () => [...offeringKeys.all, 'detail'] as const,
  // No separate poll key: the detail query self-polls the escrow deploy status (plan D1).
  detail: (id: string) => [...offeringKeys.details(), id] as const,
};
