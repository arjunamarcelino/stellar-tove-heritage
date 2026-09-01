import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateMissionDto } from './create-mission.dto';

export class UpdateMissionDto extends PartialType(OmitType(CreateMissionDto, ['stageId'])) {}
