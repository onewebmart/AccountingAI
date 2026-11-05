import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, Length, ValidateIf, ValidateNested } from 'class-validator';
import { LANGUAGES, MAX_CONTACT_PERSONS, PARTY_CURRENCIES, PAYMENT_TERMS, SALUTATIONS } from './party-profile';

/**
 * The optional details a customer or vendor form sends beyond the name and
 * GSTIN, shared by the sales and purchase bodies. Formats that need the
 * country or the GSTIN to judge (pincode, PAN, the state) are checked in
 * party-profile.ts, where the message can say why. null clears a field.
 */

const filled = (_: unknown, v: unknown) => v !== null && v !== undefined && v !== '';

export class PartyAddressDto {
  @IsOptional() @IsString() @Length(0, 100) attention?: string | null;
  @IsOptional() @IsString() @Length(0, 60) country?: string | null;
  @IsOptional() @IsString() @Length(0, 200) street1?: string | null;
  @IsOptional() @IsString() @Length(0, 200) street2?: string | null;
  @IsOptional() @IsString() @Length(0, 100) city?: string | null;
  @IsOptional() @IsString() @Length(0, 2) stateCode?: string | null;
  @IsOptional() @IsString() @Length(0, 12) pincode?: string | null;
  @IsOptional() @IsString() @Length(0, 20) phone?: string | null;
  @IsOptional() @IsString() @Length(0, 20) fax?: string | null;
}

export class ContactPersonDto {
  @IsOptional() @ValidateIf(filled) @IsIn(SALUTATIONS) salutation?: string | null;
  @IsOptional() @IsString() @Length(0, 100) firstName?: string | null;
  @IsOptional() @IsString() @Length(0, 100) lastName?: string | null;
  @IsOptional() @ValidateIf(filled) @IsEmail({}, { message: 'A contact person’s email must look like name@example.com' }) email?: string | null;
  @IsOptional() @IsString() @Length(0, 20) workPhone?: string | null;
  @IsOptional() @IsString() @Length(0, 20) mobile?: string | null;
}

export class PartySocialDto {
  @IsOptional() @IsString() @Length(0, 100) x?: string | null;
  @IsOptional() @IsString() @Length(0, 100) skype?: string | null;
  @IsOptional() @IsString() @Length(0, 200) facebook?: string | null;
}

/** Extended by the create and edit bodies for customers and vendors. */
export class PartyProfileDto {
  @IsOptional() @ValidateIf(filled) @IsIn(SALUTATIONS, { message: `salutation must be one of ${SALUTATIONS.join(', ')}` }) salutation?: string | null;
  @IsOptional() @IsString() @Length(0, 100) firstName?: string | null;
  @IsOptional() @IsString() @Length(0, 100) lastName?: string | null;
  @IsOptional() @IsString() @Length(0, 200) companyName?: string | null;

  /** The same field as phone, under the name the form uses. */
  @IsOptional() @IsString() @Length(0, 20) workPhone?: string | null;
  @IsOptional() @IsString() @Length(0, 20) mobile?: string | null;

  @IsOptional() @ValidateIf(filled) @IsIn(LANGUAGES) language?: string | null;
  @IsOptional() @ValidateIf(filled) @IsIn(PARTY_CURRENCIES, { message: `currency must be INR or one of ${PARTY_CURRENCIES.slice(1).join(', ')}` }) currency?: string | null;
  @IsOptional() @ValidateIf(filled) @IsIn(PAYMENT_TERMS, { message: `paymentTerms must be one of ${PAYMENT_TERMS.join(', ')}` }) paymentTerms?: string | null;

  @IsOptional() @IsString() @Length(0, 200) website?: string | null;
  @IsOptional() @IsString() @Length(0, 100) department?: string | null;
  @IsOptional() @IsString() @Length(0, 100) designation?: string | null;

  @IsOptional() @ValidateNested() @Type(() => PartySocialDto) social?: PartySocialDto | null;
  @IsOptional() @ValidateNested() @Type(() => PartyAddressDto) billingAddress?: PartyAddressDto | null;
  @IsOptional() @ValidateNested() @Type(() => PartyAddressDto) shippingAddress?: PartyAddressDto | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CONTACT_PERSONS)
  @ValidateNested({ each: true })
  @Type(() => ContactPersonDto)
  contactPersons?: ContactPersonDto[] | null;

  /** The same field as notes: for internal use, never printed. */
  @IsOptional() @IsString() @Length(0, 2000) remarks?: string | null;
}

/**
 * Blank, or an email address. The primary email is checked here, at the
 * door, rather than in the service, so an import keeps what its source had.
 */
export const filledValue = filled;
