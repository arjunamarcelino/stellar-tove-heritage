import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { ErrorCode } from '@common/enums/error-code.enum';
import { VerificationMethod } from '@common/enums/verification-method.enum';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { Mission } from './entities/mission.entity';
import { IMissionRepository } from './repositories/mission-repository.interface';
import { Stage } from '../stages/entities/stage.entity';
import { IStageRepository } from '../stages/repositories/stage-repository.interface';
import { CreateMissionDto } from './dto/create-mission.dto';
import { UpdateMissionDto } from './dto/update-mission.dto';
import { MissionResponseDto } from './dto/mission-response.dto';

@Injectable()
export class MissionsService {
  constructor(
    @Inject('IMissionRepository')
    private readonly missionRepository: IBaseRepository<Mission> & IMissionRepository,
    @Inject('IStageRepository')
    private readonly stageRepository: IBaseRepository<Stage> & IStageRepository,
  ) {}

  async findAll(
    page: number,
    limit: number,
    stageId?: string,
  ): Promise<PaginatedResponseDto<MissionResponseDto>> {
    const where = stageId ? { stageId } : {};
    const [missions, total] = await this.missionRepository.findWithPagination(
      { where, order: { order: 'ASC' } },
      page,
      limit,
    );
    return PaginatedResponseDto.create(
      missions.map((mission) => MissionResponseDto.fromEntity(mission)),
      total,
      page,
      limit,
    );
  }

  async findOneById(id: string): Promise<MissionResponseDto> {
    const mission = await this.missionRepository.findOneById(id);
    if (!mission) {
      throw new NotFoundException(ErrorCode.MISSION_NOT_FOUND);
    }
    return MissionResponseDto.fromEntity(mission);
  }

  async create(dto: CreateMissionDto, adminId: string): Promise<MissionResponseDto> {
    const stage = await this.stageRepository.findOneById(dto.stageId);
    if (!stage) {
      throw new NotFoundException(ErrorCode.MISSION_STAGE_NOT_FOUND);
    }

    const entity = this.missionRepository.create({
      stageId: dto.stageId,
      title: dto.title,
      description: dto.description ?? null,
      order: dto.order,
      evidenceType: dto.evidenceType,
      verificationMethod: dto.verificationMethod ?? VerificationMethod.MANUAL,
      verificationConfig: dto.verificationConfig ?? null,
      isActive: dto.isActive ?? true,
      createdBy: adminId,
    });

    try {
      const saved = await this.missionRepository.save(entity);
      return MissionResponseDto.fromEntity(saved);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(ErrorCode.MISSION_ORDER_CONFLICT);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateMissionDto, adminId: string): Promise<MissionResponseDto> {
    const entity = await this.missionRepository.findOneById(id);
    if (!entity) {
      throw new NotFoundException(ErrorCode.MISSION_NOT_FOUND);
    }

    if (dto.title !== undefined) entity.title = dto.title;
    if (dto.description !== undefined) entity.description = dto.description ?? null;
    if (dto.order !== undefined) entity.order = dto.order;
    if (dto.evidenceType !== undefined) entity.evidenceType = dto.evidenceType;
    if (dto.verificationMethod !== undefined) entity.verificationMethod = dto.verificationMethod;
    if (dto.verificationConfig !== undefined) entity.verificationConfig = dto.verificationConfig ?? null;
    if (dto.isActive !== undefined) entity.isActive = dto.isActive;
    entity.updatedBy = adminId;

    try {
      const saved = await this.missionRepository.save(entity);
      return MissionResponseDto.fromEntity(saved);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(ErrorCode.MISSION_ORDER_CONFLICT);
      }
      throw err;
    }
  }

  async softDelete(id: string): Promise<void> {
    const entity = await this.missionRepository.findOneById(id);
    if (!entity) {
      throw new NotFoundException(ErrorCode.MISSION_NOT_FOUND);
    }
    await this.missionRepository.softRemove(entity);
  }
}
