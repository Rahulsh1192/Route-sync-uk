import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum UploadFileKind {
  front = 'front',
  rear = 'rear',
  gpx = 'gpx',
}

export class DeclaredFileDto {
  @IsEnum(UploadFileKind)
  kind!: UploadFileKind;

  @IsString()
  originalName!: string;

  @IsString()
  contentType!: string;

  @IsInt()
  @Min(1)
  bytes!: number;
}

export class InitUploadDto {
  @IsString()
  title!: string; // route title (route is created in draft at init)

  @IsOptional()
  @IsString()
  description?: string;

  // Phase 20: every route must belong to a test centre, so this is now required.
  @IsUUID()
  testCentreId!: string;

  @IsOptional()
  @IsString()
  clockSource?: string; // 'gps' | 'camera_gps' | 'file_mtime'

  @IsOptional()
  @IsString()
  agreementVersion?: string; // contributor footage-licensing agreement accepted

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeclaredFileDto)
  files!: DeclaredFileDto[];
}
