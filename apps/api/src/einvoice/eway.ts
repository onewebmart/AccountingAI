/**
 * E-way bill rules: when one is needed, how long it lasts, what a vehicle
 * number looks like. Pure. Distance comes from the person (or a pincode
 * lookup later), never a guess.
 */

/** A consignment worth more than this needs an e-way bill (rule 138). States may set their own. */
export const EWB_THRESHOLD_PAISE = 50_000_00;
/** The e-way bill system takes distances up to this. */
export const MAX_DISTANCE_KM = 4000;

/** "MH 12 AB 1234" → "MH12AB1234", or null when it cannot be an Indian vehicle number. */
export function normaliseVehicleNo(raw: string): string | null {
  const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // State, district, series, number; or a temporary (TR…) or defence (…) style left to the portal.
  if (/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(v)) return v;
  if (/^\d{2}BH\d{4}[A-Z]{1,2}$/.test(v)) return v; // Bharat series
  if (/^TR[A-Z0-9]{6,13}$/.test(v)) return v;
  return null;
}

/**
 * Days an e-way bill lasts: one per 200 km or part of it (20 km for
 * over-dimensional cargo).
 */
export function validDays(distanceKm: number, vehicleType: 'regular' | 'odc'): number {
  return Math.max(1, Math.ceil(distanceKm / (vehicleType === 'odc' ? 20 : 200)));
}

/**
 * When it runs out. Each day ends at midnight of the day after it starts,
 * so a 1-day bill made on the 5th lasts until the end of the 6th (IST).
 */
export function validUpto(generatedAt: Date, days: number): Date {
  const ist = new Date(generatedAt.getTime() + 330 * 60_000);
  const day = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + days);
  // 23:59:59 IST on that day.
  return new Date(day + (24 * 60 - 330) * 60_000 - 1000);
}

/** Extension is allowed from 8 hours before it expires to 8 hours after. */
export function canExtend(validUntil: Date, now: Date): boolean {
  const eight = 8 * 3600_000;
  return now.getTime() >= validUntil.getTime() - eight && now.getTime() <= validUntil.getTime() + eight;
}

/** Cancellation is allowed within 24 hours of generating it. */
export const within24h = (from: Date, now: Date) => now.getTime() - from.getTime() <= 24 * 3600_000;
