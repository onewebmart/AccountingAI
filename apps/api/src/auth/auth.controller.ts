import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { RefreshAuthGuard } from './guards/refresh-auth.guard';
import { AuthGuard } from '@nestjs/passport';
import { Public, CurrentUser, JwtPayload } from './decorators';
import {
  SignupDto,
  VerifyTotpDto,
  EnableTotpDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  RefreshTokenDto,
} from './dto/auth.dto';
import { UserDocument } from '../tenancy/schemas/user.schema';
import { ConfigService } from '@nestjs/config';

interface AuthRequest extends Request {
  user: UserDocument | JwtPayload | { userId: string; rawToken: string };
}

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private config: ConfigService,
  ) {}

  // ─── Signup ───────────────────────────────────────────────────────

  @Public()
  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  // ─── Login (email/password) ───────────────────────────────────────

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Req() req: AuthRequest) {
    return this.auth.login(req.user as UserDocument);
  }

  // ─── TOTP challenge completion ────────────────────────────────────

  @Public()
  @Post('login/totp')
  @HttpCode(HttpStatus.OK)
  async loginTotp(@Body() dto: VerifyTotpDto) {
    return this.auth.loginWithTotp(dto.tempToken, dto.code);
  }

  // ─── Token refresh ────────────────────────────────────────────────

  @Public()
  @UseGuards(RefreshAuthGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: AuthRequest) {
    const payload = req.user as unknown as { sub: string; jti: string };
    return this.auth.refreshTokens(payload.sub, payload.jti);
  }

  // ─── Logout ───────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: JwtPayload) {
    await this.auth.logout(user.sub);
  }

  // ─── Google OAuth ─────────────────────────────────────────────────

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Passport redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: AuthRequest,
    @Res() res: Response,
  ) {
    const profile = req.user as {
      googleId: string;
      email: string;
      name: string;
      avatarUrl?: string;
    };
    const result = await this.auth.googleAuth(profile);
    const webUrl = this.config.get<string>('urls.web');
    // Redirect to frontend with tokens as query params (secure: use short-lived state instead in prod)
    res.redirect(
      `${webUrl}/auth/callback?accessToken=${result.tokens.accessToken}&refreshToken=${result.tokens.refreshToken}`,
    );
  }

  // ─── Password reset ───────────────────────────────────────────────

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    // Always 204 — never reveal whether email exists
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
  }

  // ─── TOTP enrollment ──────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('totp/enroll')
  async totpEnroll(@CurrentUser() user: JwtPayload) {
    return this.auth.enrollTotp(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('totp/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  async totpVerify(@CurrentUser() user: JwtPayload, @Body() dto: EnableTotpDto) {
    await this.auth.verifyAndEnableTotp(user.sub, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('totp/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async totpDisable(@CurrentUser() user: JwtPayload) {
    await this.auth.disableTotp(user.sub);
  }

  // ─── Auth status ──────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    return { userId: user.sub, email: user.email, orgId: user.orgId, role: user.role };
  }
}
