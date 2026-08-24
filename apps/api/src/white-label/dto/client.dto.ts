import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ClientType, FirmService } from '@ai-accounting/shared';

/**
 * Body for POST /api/v1/firm/clients.
 *
 * This is a class, not an interface, on purpose: Nest's ValidationPipe can only
 * validate (and whitelist) a class metatype. The previous interface meant the
 * request body reached the service unvalidated.
 *
 * firmId is deliberately absent — it comes from the verified JWT, never the body.
 */
export class AddClientDto {
  @IsString()
  @Length(1, 200)
  name: string;

  /** 15-char GSTIN. Optional: unregistered clients have none. */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/, {
    message: 'gstin must be a valid 15-character GSTIN',
  })
  gstin?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, {
    message: 'pan must be a valid 10-character PAN',
  })
  pan?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsEnum(ClientType)
  clientType?: ClientType;

  /** Digits only, 10–15 chars, so the messaging adapter can normalise it. */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10,15}$/, {
    message: 'whatsappNumber must be 10–15 digits, no spaces or symbols',
  })
  whatsappNumber?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  contactName?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(FirmService, { each: true })
  services?: FirmService[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  financialYearStart?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
