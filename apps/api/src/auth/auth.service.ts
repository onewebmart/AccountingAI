import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import { randomUUID } from 'crypto';
import { UserRole } from '@ai-accounting/shared';
import { User, UserDocument } from '../tenancy/schemas/user.schema';
import { TenancyService } from '../tenancy/tenancy.service';
import { EmailService } from './email.service';
import { JwtPayload } from './decorators';
import { SignupDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult {
  user: { id: string; name: string; email: string };
  org: { id: string; name: string };
  tokens: TokenPair;
}

export interface TotpChallengeResult {
  requiresTotp: true;
  tempToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private tenancy: TenancyService,
    private jwt: JwtService,
    private config: ConfigService,
    private email: EmailService,
  ) {}

  // ─── Signup ───────────────────────────────────────────────────────

  async signup(dto: SignupDto): Promise<AuthResult> {
    const existing = await this.tenancy.findUserByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with that email already exists.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Create user
    const user = await this.userModel.create({
      name: dto.name,
      email: dto.email.toLowerCase(),
      passwordHash,
    });

    // Create org and make user the Company Admin
    const org = await this.tenancy.createOrganization({
      name: dto.businessName,
      gstin: dto.gstin,
    });

    await this.tenancy.createMembership({
      orgId: org._id.toString(),
      userId: user._id.toString(),
      role: UserRole.COMPANY_ADMIN,
    });

    // Fire-and-forget welcome email
    this.email.sendWelcome(user.email, user.name).catch((e) => {
      this.logger.warn(`Welcome email failed: ${String(e)}`);
    });

    const tokens = await this.issueTokens(user, org._id.toString());
    return {
      user: { id: user._id.toString(), name: user.name, email: user.email },
      org: { id: org._id.toString(), name: org.name },
      tokens,
    };
  }

  // ─── Login ────────────────────────────────────────────────────────

  /** Called by LocalStrategy — validates credentials only */
  async validateCredentials(email: string, password: string): Promise<UserDocument | null> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase(), isActive: true })
      .select('+passwordHash')
      .exec();

    if (!user?.passwordHash) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user : null;
  }

  /**
   * Called after LocalStrategy succeeds.
   * If TOTP is enabled, returns a short-lived temp token for the TOTP challenge.
   * Otherwise issues full tokens.
   */
  async login(user: UserDocument, requestedOrgId?: string): Promise<AuthResult | TotpChallengeResult> {
    // Resolve which org to use (user's primary org)
    const activeOrgId = requestedOrgId ?? (await this.getPrimaryOrgId(user._id.toString()));
    if (!activeOrgId) {
      throw new BadRequestException('No organization found. Complete onboarding first.');
    }

    if (user.totpEnabled) {
      // Issue a short-lived temp token — the client must complete TOTP to get real tokens
      const tempToken = this.jwt.sign(
        { sub: user._id.toString(), email: user.email, orgId: activeOrgId, type: 'temp' },
        { expiresIn: '5m', secret: this.config.get<string>('jwt.accessSecret') },
      );
      return { requiresTotp: true, tempToken };
    }

    const tokens = await this.issueTokens(user, activeOrgId);
    return {
      user: { id: user._id.toString(), name: user.name, email: user.email },
      org: { id: activeOrgId, name: '' },
      tokens,
    };
  }

  /** Complete TOTP challenge — validates the 6-digit code and issues real tokens */
  async loginWithTotp(tempToken: string, code: string): Promise<AuthResult> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(tempToken, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
    } catch {
      throw new UnauthorizedException('Temp token expired or invalid. Sign in again.');
    }

    if (payload.type !== 'temp') throw new UnauthorizedException('Invalid token type.');

    const user = await this.userModel.findById(payload.sub).select('+totpSecret').exec();
    if (!user?.totpSecret) throw new UnauthorizedException('TOTP not configured.');

    const valid = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!valid) throw new UnauthorizedException('Invalid 2FA code. Try again.');

    const tokens = await this.issueTokens(user, payload.orgId);
    return {
      user: { id: user._id.toString(), name: user.name, email: user.email },
      org: { id: payload.orgId, name: '' },
      tokens,
    };
  }

  // ─── Token rotation ───────────────────────────────────────────────

  async refreshTokens(userId: string, refreshJti: string): Promise<TokenPair> {
    const user = await this.userModel.findById(userId).select('+refreshTokenHash').exec();
    if (!user?.refreshTokenHash) throw new UnauthorizedException('Session expired. Sign in again.');

    // Compare the jti (UUID from the verified JWT payload) against the stored bcrypt hash.
    // We hash only the jti because the full JWT token exceeds bcrypt's 72-byte input limit.
    const valid = await bcrypt.compare(refreshJti, user.refreshTokenHash);
    if (!valid) throw new UnauthorizedException('Invalid refresh token. Sign in again.');

    const orgId = await this.getPrimaryOrgId(userId);
    if (!orgId) throw new UnauthorizedException('No active organization.');

    return this.issueTokens(user, orgId);
  }

  async logout(userId: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(userId, { $unset: { refreshTokenHash: 1 } })
      .exec();
  }

  // ─── Google OAuth ─────────────────────────────────────────────────

  async googleAuth(profile: {
    googleId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }): Promise<AuthResult> {
    let user = await this.userModel.findOne({ email: profile.email.toLowerCase() }).exec();

    if (user) {
      // Link Google ID if not already linked
      if (!user.googleId) {
        await this.userModel.updateOne({ _id: user._id }, { googleId: profile.googleId }).exec();
      }
    } else {
      // Create new user — they still need to create an org via onboarding
      user = await this.userModel.create({
        email: profile.email.toLowerCase(),
        googleId: profile.googleId,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      });
    }

    const orgId = await this.getPrimaryOrgId(user._id.toString());

    if (!orgId) {
      // New Google user — create a default org
      const org = await this.tenancy.createOrganization({ name: `${profile.name}'s Business` });
      await this.tenancy.createMembership({
        orgId: org._id.toString(),
        userId: user._id.toString(),
        role: UserRole.COMPANY_ADMIN,
      });
      const tokens = await this.issueTokens(user, org._id.toString());
      return {
        user: { id: user._id.toString(), name: user.name, email: user.email },
        org: { id: org._id.toString(), name: org.name },
        tokens,
      };
    }

    const tokens = await this.issueTokens(user, orgId);
    return {
      user: { id: user._id.toString(), name: user.name, email: user.email },
      org: { id: orgId, name: '' },
      tokens,
    };
  }

  // ─── TOTP enrollment ──────────────────────────────────────────────

  async enrollTotp(userId: string): Promise<{ qrCodeDataUrl: string; manualKey: string }> {
    const user = await this.tenancy.findUserById(userId);
    if (!user) throw new NotFoundException('User not found.');

    const secret = speakeasy.generateSecret({
      name: `AiBooks (${user.email})`,
      length: 20,
    });

    // Store the secret temporarily (it's only activated when the user verifies)
    await this.userModel
      .updateOne({ _id: userId }, { totpSecret: secret.base32 })
      .exec();

    const otpAuthUrl = secret.otpauth_url ?? '';
    const qrCodeDataUrl = await qrcode.toDataURL(otpAuthUrl);

    return { qrCodeDataUrl, manualKey: secret.base32 };
  }

  async verifyAndEnableTotp(userId: string, code: string): Promise<void> {
    const user = await this.userModel.findById(userId).select('+totpSecret').exec();
    if (!user?.totpSecret) throw new BadRequestException('Start enrollment first.');

    const valid = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    });

    if (!valid) throw new BadRequestException('Invalid code. Scan the QR code again.');

    await this.userModel.updateOne({ _id: userId }, { totpEnabled: true }).exec();
  }

  async disableTotp(userId: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { totpEnabled: false, $unset: { totpSecret: 1 } })
      .exec();
  }

  // ─── Password reset ───────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const user = await this.tenancy.findUserByEmail(email);
    if (!user) return; // Silent — don't reveal whether email exists

    const token = this.jwt.sign(
      { sub: user._id.toString(), email: user.email, type: 'reset' },
      {
        secret: this.config.get<string>('jwt.resetSecret'),
        expiresIn: this.config.get<string>('jwt.resetExpiresIn'),
      },
    );

    const webUrl = this.config.get<string>('urls.web');
    const resetLink = `${webUrl}/auth/reset-password?token=${token}`;

    await this.email.sendPasswordReset(user.email, user.name, resetLink).catch((e) => {
      this.logger.warn(`Password reset email failed: ${String(e)}`);
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    let payload: { sub: string; type: string };
    try {
      payload = this.jwt.verify(token, {
        secret: this.config.get<string>('jwt.resetSecret'),
      }) as { sub: string; type: string };
    } catch {
      throw new BadRequestException('Reset link is invalid or has expired. Request a new one.');
    }

    if (payload.type !== 'reset') throw new BadRequestException('Invalid token type.');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.userModel
      .updateOne(
        { _id: payload.sub },
        { passwordHash, $unset: { refreshTokenHash: 1 } }, // revoke all sessions
      )
      .exec();
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async issueTokens(user: UserDocument, orgId: string): Promise<TokenPair> {
    const membership = await this.tenancy.getMembership(user._id.toString(), orgId);
    const role = membership?.role ?? UserRole.EMPLOYEE;

    const accessPayload: JwtPayload & { jti: string } = {
      sub: user._id.toString(),
      email: user.email,
      orgId,
      role,
      type: 'access',
      jti: randomUUID(), // ensures each token is unique even within the same second
    };

    const refreshJti = randomUUID();
    const accessToken = this.jwt.sign(accessPayload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
    });

    const refreshToken = this.jwt.sign(
      { sub: user._id.toString(), type: 'refresh', jti: refreshJti },
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
      },
    );

    // bcrypt has a 72-byte input limit — JWT strings exceed this, making full-token
    // hashing unsafe (tokens sharing a user/timestamp collide at byte 72+).
    // Hash only the jti (36-char UUID) which is always unique and well under the limit.
    const refreshTokenHash = await bcrypt.hash(refreshJti, BCRYPT_ROUNDS);
    await this.userModel
      .findByIdAndUpdate(user._id, { $set: { refreshTokenHash } })
      .exec();

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // 15 minutes in seconds
    };
  }

  private async getPrimaryOrgId(userId: string): Promise<string | null> {
    const memberships = await this.tenancy.findUserMemberships(userId);
    return memberships[0]?.orgId ?? null;
  }
}
