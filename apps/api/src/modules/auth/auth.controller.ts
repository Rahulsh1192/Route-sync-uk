import { Body, Controller, Post, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshDto, OAuthDto } from './dto/auth.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.password, dto.displayName);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('oauth/google')
  @HttpCode(200)
  google(@Body() dto: OAuthDto) {
    return this.auth.loginWithGoogle(dto.token, dto.displayName);
  }

  @Post('oauth/apple')
  @HttpCode(200)
  apple(@Body() dto: OAuthDto) {
    return this.auth.loginWithApple(dto.token, dto.displayName);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async logout(@CurrentUser() user: AuthUser, @Body() dto: RefreshDto) {
    await this.auth.logout(user.id, dto.refreshToken);
  }
}
