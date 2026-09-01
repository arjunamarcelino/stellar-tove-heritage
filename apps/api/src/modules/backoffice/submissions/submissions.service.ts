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
import { SubmissionStatus } from '@common/enums/submission-status.enum';
import { isUniqueConstraintError } from '@common/utils/database.utils';
import { Submission } from '../../submissions/entities/submission.entity';
import { ISubmissionRepository } from '../../submissions/repositories/submission-repository.interface';
import { SubmissionResponseDto } from '../../submissions/dto/submission-response.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { SubmissionFilterDto } from './dto/submission-filter.dto';
import { FindOptionsWhere } from 'typeorm';

@Injectable()
export class BackofficeSubmissionsService {
  constructor(
    @Inject('ISubmissionRepository')
    private readonly submissionRepository: IBaseRepository<Submission> & ISubmissionRepository,
  ) {}

  async findAll(
    page: number,
    limit: number,
    filters: SubmissionFilterDto,
  ): Promise<PaginatedResponseDto<SubmissionResponseDto>> {
    const where: FindOptionsWhere<Submission> = {};
    if (filters.missionId) where.missionId = filters.missionId;
    if (filters.status) where.status = filters.status;
    if (filters.userId) where.userId = filters.userId;

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

  async findOneById(id: string): Promise<SubmissionResponseDto> {
    const submission = await this.submissionRepository.findOneById(id);
    if (!submission) {
      throw new NotFoundException(ErrorCode.SUBMISSION_NOT_FOUND);
    }
    return SubmissionResponseDto.fromEntity(submission);
  }

  async review(
    id: string,
    dto: ReviewSubmissionDto,
    adminId: string,
  ): Promise<SubmissionResponseDto> {
    const submission = await this.submissionRepository.findOneById(id);
    if (!submission) {
      throw new NotFoundException(ErrorCode.SUBMISSION_NOT_FOUND);
    }

    if (submission.status !== SubmissionStatus.PENDING) {
      throw new BadRequestException(ErrorCode.SUBMISSION_INVALID_REVIEW);
    }

    submission.status = dto.status;
    submission.adminNotes = dto.adminNotes ?? null;
    submission.reviewedBy = adminId;
    submission.reviewedAt = new Date();

    try {
      const saved = await this.submissionRepository.save(submission);
      return SubmissionResponseDto.fromEntity(saved);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(ErrorCode.SUBMISSION_ALREADY_ACCEPTED);
      }
      throw err;
    }
  }
}
