import { IsEmail, IsString, Matches, MaxLength, MinLength, IsOptional } from 'class-validator';
import { PHONE_MESSAGE, PHONE_PATTERN } from '../../../common/validation/phone';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(2)
  displayName!: string;

  /**
   * Contact number. Optional, so an account can still be created without one and so
   * Google/Apple sign-ins (which never return a phone number) aren't a special case.
   *
   * Validated by shape rather than with `@IsPhoneNumber`: that requires a region and
   * rejects a number the user knows is correct if they typed it in an unexpected format,
   * which is a poor trade at signup. This accepts the ways people actually write a UK
   * number — `07700 900123`, `+44 7700 900123`, `(01234) 567890`.
   */
  @IsOptional() @IsString() @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;

  @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string;

  @IsOptional() @IsString() @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  emergencyContactPhone?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class OAuthDto {
  // id_token / identity_token from Google or Apple
  @IsString()
  token!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}
