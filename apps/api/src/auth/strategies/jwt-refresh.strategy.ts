import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

export interface RefreshPayload {
  sub: string;   // userId
  type: 'refresh';
  jti: string;   // unique token ID — used for revocation check
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      // Accept refresh token from body (client sends it explicitly)
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.refreshSecret')!,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: RefreshPayload): Promise<RefreshPayload & { rawToken: string }> {
    if (payload.type !== 'refresh') throw new UnauthorizedException('Invalid token type.');
    const rawToken = (req.body as { refreshToken?: string }).refreshToken ?? '';
    return { ...payload, rawToken };
  }
}
