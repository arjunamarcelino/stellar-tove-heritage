import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { IBaseRepository } from '@common/repositories/base-repository.interface';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';
import { ErrorCode } from '@common/enums/error-code.enum';
import { EvidenceType } from '@common/enums/evidence-type.enum';
import { SubmissionStatus } from '@common/enums/submission-status.enum';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { Submission } from './entities/submission.entity';
import { ISubmissionRepository } from './repositories/submission-repository.interface';
import { Mission } from '../backoffice/missions/entities/mission.entity';
import { IMissionRepository } from '../backoffice/missions/repositories/mission-repository.interface';
import { Stage } from '../backoffice/stages/entities/stage.entity';
import { IStageRepository } from '../backoffice/stages/repositories/stage-repository.interface';
import { SubmitEvidenceDto } from './dto/submit-evidence.dto';
import { SubmissionResponseDto } from './dto/submission-response.dto';

@Injectable()
export class SubmissionsService {
  constructor(
    @Inject('ISubmissionRepository')
    private readonly submissionRepository: IBaseRepository<Submission> & ISubmissionRepository,
    @Inject('IMissionRepository')
    private readonly missionRepository: IBaseRepository<Mission> & IMissionRepository,
    @Inject('IStageRepository')
    private readonly stageRepository: IBaseRepository<Stage> & IStageRepository,
  ) {}

  async submit(
    userId: string,
    missionId: string,
    dto: SubmitEvidenceDto,
  ): Promise<SubmissionResponseDto> {
    const mission = await this.missionRepository.findOneById(missionId);
    if (!mission || !mission.isActive) {
      throw new NotFoundException(ErrorCode.MISSION_NOT_FOUND);
    }

    const [stage, accepted, pending] = await Promise.all([
      this.stageRepository.findOneById(mission.stageId),
      this.submissionRepository.findAccepted(userId, missionId),
      this.submissionRepository.findPending(userId, missionId),
    ]);

    if (!stage || !stage.isEffectivelyActive) {
      throw new BadRequestException(ErrorCode.SUBMISSION_STAGE_NOT_ACTIVE);
    }
    if (accepted) {
      throw new ConflictException(ErrorCode.SUBMISSION_ALREADY_ACCEPTED);
    }
    if (pending) {
      throw new ConflictException(ErrorCode.SUBMISSION_ALREADY_PENDING);
    }

    this.validateEvidence(dto, mission.evidenceType);

    const entity = this.submissionRepository.create({
      userId,
      missionId,
      status: SubmissionStatus.PENDING,
      fileUrl: null,
      linkUrl: dto.linkUrl ?? null,
      textContent: dto.textContent ?? null,
    });

    try {
      const saved = await this.submissionRepository.save(entity);
      return SubmissionResponseDto.fromEntity(saved);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(ErrorCode.SUBMISSION_ALREADY_PENDING);
      }
      throw err;
    }
  }

  async findAllByUser(
    userId: string,
    page: number,
    limit: number,
    status?: SubmissionStatus,
  ): Promise<PaginatedResponseDto<SubmissionResponseDto>> {
    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;
    const [submissions, total] = await this.submissionRepository.findWithPagination(
      { where, order: { createdAt: 'DESC' } },
      page,
      limit,
    );
    return PaginatedResponseDto.create(
      submissions.map((s) => SubmissionResponseDto.fromEntity(s)),
      total,
      page,
      limit,
    );
  }

  private validateEvidence(dto: SubmitEvidenceDto, evidenceType: EvidenceType): void {
    switch (evidenceType) {
      case EvidenceType.URL:
        if (!dto.linkUrl) {
          throw new BadRequestException(ErrorCode.SUBMISSION_EVIDENCE_MISMATCH);
        }
        break;
      case EvidenceType.TEXT:
        if (!dto.textContent) {
          throw new BadRequestException(ErrorCode.SUBMISSION_EVIDENCE_MISMATCH);
        }
        break;
      case EvidenceType.FILE:
        // File upload handled separately via multipart
        break;
    }
  }

}
