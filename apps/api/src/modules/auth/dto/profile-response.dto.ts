import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserResponseDto } from '@modules/users/dto/user-response.dto';
import { StageProgressDto } from '@modules/stages/dto/stage-progress.dto';

export class ProfileResponseDto extends UserResponseDto {
  @ApiPropertyOptional({ type: StageProgressDto, nullable: true })
  currentStage!: StageProgressDto | null;

  static create(params: {
    user: UserResponseDto;
    currentStage: StageProgressDto | null;
  }): ProfileResponseDto {
    const dto = new ProfileResponseDto();
    dto.id = params.user.id;
    dto.email = params.user.email;
    dto.firstName = params.user.firstName;
    dto.lastName = params.user.lastName;
    dto.isActive = params.user.isActive;
    dto.createdAt = params.user.createdAt;
    dto.currentStage = params.currentStage;
    return dto;
  }
}
