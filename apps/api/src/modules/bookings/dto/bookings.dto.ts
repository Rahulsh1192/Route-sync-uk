import {
  IsUUID, IsString, IsInt, IsOptional, Min, Max, IsDateString, IsBoolean, IsNumber, MaxLength,
} from 'class-validator';

export class UpdateInstructorProfileDto {
  @IsOptional() @IsString()  bio?: string;
  // The instructor's own price, in pence. Min 0 rather than a floor: what to charge is the
  // instructor's decision, and the platform fee is added on top at checkout.
  @IsOptional() @IsInt() @Min(0) lessonPriceMinor?: number;
  @IsOptional() @IsInt() @Min(0) yearsExperience?: number;
  @IsOptional() @IsBoolean()     isAcceptingBookings?: boolean;
  /** Where they are based. Geocoded on save; without it they cannot appear in a local search. */
  @IsOptional() @IsString() @MaxLength(12) basePostcode?: string;
  /**
   * How far they will travel for a lesson. Capped at 100km here and again at MAX_NEARBY_KM
   * when searching — the DTO limit stops absurd values being stored, the search limit stops
   * a large-but-legal radius presenting someone as local.
   */
  @IsOptional() @IsNumber() @Min(1) @Max(100) travelRadiusKm?: number;
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
