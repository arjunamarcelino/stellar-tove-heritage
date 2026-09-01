import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { ErrorCode } from '@common/enums/error-code.enum';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { Stage } from './entities/stage.entity';
import { IStageRepository } from './repositories/stage-repository.interface';
import { Mission } from '../missions/entities/mission.entity';
import { IMissionRepository } from '../missions/repositories/mission-repository.interface';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { StageResponseDto } from './dto/stage-response.dto';

@Injectable()
export class StagesService {
  constructor(
    @Inject('IStageRepository')
    private readonly stageRepository: IBaseRepository<Stage> & IStageRepository,
    @Inject('IMissionRepository')
    private readonly missionRepository: IBaseRepository<Mission> & IMissionRepository,
  ) {}

  async findAll(page: number, limit: number): Promise<PaginatedResponseDto<StageResponseDto>> {
    const [stages, total] = await this.stageRepository.findWithPagination(
      { order: { order: 'ASC' } },
      page,
      limit,
    );
    return PaginatedResponseDto.create(
      stages.map((stage) => StageResponseDto.fromEntity(stage)),
      total,
      page,
      limit,
    );
  }

  async findOneById(id: string): Promise<StageResponseDto> {
    const stage = await this.stageRepository.findOneById(id);
    if (!stage) {
      throw new NotFoundException(ErrorCode.STAGE_NOT_FOUND);
    }
    return StageResponseDto.fromEntity(stage);
  }

  async create(dto: CreateStageDto, adminId: string): Promise<StageResponseDto> {
    const entity = this.stageRepository.create({
      title: dto.title,
      description: dto.description ?? null,
      order: dto.order,
      isActive: dto.isActive ?? false,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      createdBy: adminId,
    });

    try {
      const saved = await this.stageRepository.save(entity);
      return StageResponseDto.fromEntity(saved);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(ErrorCode.STAGE_ORDER_CONFLICT);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateStageDto, adminId: string): Promise<StageResponseDto> {
    const entity = await this.stageRepository.findOneById(id);
    if (!entity) {
      throw new NotFoundException(ErrorCode.STAGE_NOT_FOUND);
    }

    if (dto.title !== undefined) entity.title = dto.title;
    if (dto.description !== undefined) entity.description = dto.description ?? null;
    if (dto.order !== undefined) entity.order = dto.order;
    if (dto.isActive !== undefined) entity.isActive = dto.isActive;
    if (dto.startsAt !== undefined) entity.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    entity.updatedBy = adminId;

    try {
      const saved = await this.stageRepository.save(entity);
      return StageResponseDto.fromEntity(saved);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(ErrorCode.STAGE_ORDER_CONFLICT);
      }
      throw err;
    }
  }

  async softDelete(id: string): Promise<void> {
    const entity = await this.stageRepository.findOneById(id);
    if (!entity) {
      throw new NotFoundException(ErrorCode.STAGE_NOT_FOUND);
    }

    const missions = await this.missionRepository.findByStageId(id);

    await this.stageRepository.runInTransaction(async (manager) => {
      if (missions.length > 0) {
        await manager.softRemove(Mission, missions);
      }
      await manager.softRemove(Stage, entity);
    });
  }
}
