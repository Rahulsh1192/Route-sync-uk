import { IsUUID, IsString, IsInt, IsOptional, Min, IsDateString, IsBoolean } from 'class-validator';

export class UpdateInstructorProfileDto {
  @IsOptional() @IsString()  bio?: string;
  @IsOptional() @IsInt() @Min(0) lessonPriceMinor?: number;
  @IsOptional() @IsInt() @Min(0) yearsExperience?: number;
  @IsOptional() @IsBoolean()     isAcceptingBookings?: boolean;
}

export class AddAvailabilitySlotDto {
  @IsDateString() slotDate!: string;       // YYYY-MM-DD
  @IsString()     startTime!: string;      // HH:MM
  @IsString()     endTime!: string;        // HH:MM
}

export class CreateBookingDto {
  @IsUUID()               instructorId!: string;
  @IsUUID()               slotId!: string;
  @IsOptional() @IsString() lessonNotes?: string;
}

export class UpdateBookingDto {
  @IsString() status!: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  @IsOptional() @IsString() cancelReason?: string;
}
