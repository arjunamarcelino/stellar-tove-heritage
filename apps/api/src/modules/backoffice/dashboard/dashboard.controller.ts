import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
import { AdminRoles } from '@common/decorators/admin-roles.decorator';
import { BackofficeGuard } from '@common/guards/backoffice.guard';
import { AdminRole } from '@common/enums/admin-role.enum';
import { DashboardService } from './dashboard.service';
import { DashboardSummaryResponseDto } from './dto/dashboard-summary-response.dto';
import { DashboardMissionStatsResponseDto } from './dto/dashboard-mission-stats-response.dto';

@ApiTags('Backoffice Dashboard')
@Controller('dashboard')
@ApiBearerAuth()
@Public()
@UseGuards(BackofficeGuard)
@AdminRoles(AdminRole.ADMIN, AdminRole.SUPERADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOkResponse({ type: DashboardSummaryResponseDto })
  getSummary(): Promise<DashboardSummaryResponseDto> {
    return this.dashboardService.getSummary();
  }

  @Get('missions')
  @ApiOkResponse({ type: [DashboardMissionStatsResponseDto] })
  getMissionStats(): Promise<DashboardMissionStatsResponseDto[]> {
    return this.dashboardService.getMissionStats();
  }
}
