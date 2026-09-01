import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from '@modules/backoffice/dashboard/dashboard.service';
import { UsersService } from '@modules/users/users.service';
import { MissionStatsRow } from '@modules/backoffice/missions/repositories/mission-repository.interface';

const mockUsersService = {
  count: vi.fn(),
};

const mockMissionRepository = {
  countMissionSummary: vi.fn(),
  getMissionSubmissionStats: vi.fn(),
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: 'IMissionRepository', useValue: mockMissionRepository },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  describe('getSummary', () => {
    it('returns correct summary counts', async () => {
      mockUsersService.count.mockResolvedValue(150);
      mockMissionRepository.countMissionSummary.mockResolvedValue([24, 18]);

      const result = await service.getSummary();

      expect(result.totalUsers).toBe(150);
      expect(result.totalMissions).toBe(24);
      expect(result.activeMissions).toBe(18);
      expect(mockUsersService.count).toHaveBeenCalledOnce();
      expect(mockMissionRepository.countMissionSummary).toHaveBeenCalledOnce();
    });

    it('returns zeros when no data exists', async () => {
      mockUsersService.count.mockResolvedValue(0);
      mockMissionRepository.countMissionSummary.mockResolvedValue([0, 0]);

      const result = await service.getSummary();

      expect(result.totalUsers).toBe(0);
      expect(result.totalMissions).toBe(0);
      expect(result.activeMissions).toBe(0);
    });
  });

  describe('getMissionStats', () => {
    const rawRows: MissionStatsRow[] = [
      {
        missionId: '550e8400-e29b-41d4-a716-446655440030',
        missionTitle: 'Follow @tove on Instagram',
        stageTitle: 'Stage 1: Social',
        totalUsers: '45',
        pending: '12',
        accepted: '30',
        rejected: '3',
      },
      {
        missionId: '550e8400-e29b-41d4-a716-446655440031',
        missionTitle: 'Join Discord',
        stageTitle: 'Stage 1: Social',
        totalUsers: '20',
        pending: '5',
        accepted: '15',
        rejected: '0',
      },
    ];

    it('returns per-mission breakdown with correct counts', async () => {
      mockMissionRepository.getMissionSubmissionStats.mockResolvedValue(rawRows);

      const result = await service.getMissionStats();

      expect(result).toHaveLength(2);
      expect(result[0].missionId).toBe('550e8400-e29b-41d4-a716-446655440030');
      expect(result[0].missionTitle).toBe('Follow @tove on Instagram');
      expect(result[0].stageTitle).toBe('Stage 1: Social');
      expect(result[0].totalUsers).toBe(45);
      expect(result[0].pending).toBe(12);
      expect(result[0].accepted).toBe(30);
      expect(result[0].rejected).toBe(3);
    });

    it('parses string counts to numbers via fromRaw', async () => {
      mockMissionRepository.getMissionSubmissionStats.mockResolvedValue(rawRows);

      const result = await service.getMissionStats();

      for (const item of result) {
        expect(typeof item.totalUsers).toBe('number');
        expect(typeof item.pending).toBe('number');
        expect(typeof item.accepted).toBe('number');
        expect(typeof item.rejected).toBe('number');
      }
    });

    it('returns empty array when no active missions', async () => {
      mockMissionRepository.getMissionSubmissionStats.mockResolvedValue([]);

      const result = await service.getMissionStats();

      expect(result).toEqual([]);
    });

    it('includes missions with zero submissions', async () => {
      const zeroRow: MissionStatsRow = {
        missionId: '550e8400-e29b-41d4-a716-446655440032',
        missionTitle: 'New Mission',
        stageTitle: 'Stage 2',
        totalUsers: '0',
        pending: '0',
        accepted: '0',
        rejected: '0',
      };
      mockMissionRepository.getMissionSubmissionStats.mockResolvedValue([zeroRow]);

      const result = await service.getMissionStats();

      expect(result).toHaveLength(1);
      expect(result[0].totalUsers).toBe(0);
      expect(result[0].pending).toBe(0);
      expect(result[0].accepted).toBe(0);
      expect(result[0].rejected).toBe(0);
    });
  });
});
