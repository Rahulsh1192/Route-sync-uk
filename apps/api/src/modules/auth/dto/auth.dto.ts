import { IsEmail, IsString, Matches, MaxLength, MinLength, IsOptional } from 'class-validator';
import { PHONE_MESSAGE, PHONE_PATTERN } from '../../../common/validation/phone';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  /**
   * Required to create an account; absent when this form is re-posted to ask for another
   * verification link, which the sign-in screen does and which has no name field to fill.
   * The length rule for the create case lives in `AuthService.register`, where the two cases
   * are distinguishable.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  displayName?: string;

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

/** Phase 28 — the address to send a reset link to. */
export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

/** Phase 28 — redeem a link. The token comes from the email, not from a session. */
export class EmailTokenDto {
  @IsString()
  @MinLength(43) // 32 random bytes, base64url
  token!: string;
}

export class ResetPasswordDto extends EmailTokenDto {
  /**
   * Same minimum as registration. Deliberately identical: a reset that accepted a weaker
   * password than signup would make "forgot password" the cheapest way to downgrade an
   * account's security.
   */
  @IsString()
  @MinLength(8)
  password!: string;
}
