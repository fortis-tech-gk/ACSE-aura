/**
 * Aadhaar number check. UIDAI numbers are 12 digits, never start with 0 or 1, and end in a
 * Verhoeff check digit — so a single mistyped or swapped digit is caught here instead of slipping
 * past the championship-wide duplicate check as a "different" number.
 */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits: string): boolean {
  let c = 0;
  const rev = digits.split('').reverse();
  for (let i = 0; i < rev.length; i++) c = D[c][P[i % 8][Number(rev[i])]];
  return c === 0;
}

/** Returns an error message, or null when the Aadhaar number is acceptable. */
export function validateAadhaar(aadhaar: string): string | null {
  if (!/^\d{12}$/.test(aadhaar)) return 'Aadhaar Number must be exactly 12 numeric digits.';
  if (/^[01]/.test(aadhaar) || !verhoeffValid(aadhaar)) {
    return 'This is not a valid Aadhaar number — please check the 12 digits on the Aadhaar card (a digit may be mistyped).';
  }
  return null;
}

/**
 * NRI / foreign students who have no Aadhaar register with their passport number instead. Both are
 * stored in `profiles.aadhaar_number` (it is the championship-wide identity key); a 12-digit
 * numeric value is an Aadhaar, anything else is a passport number.
 */
export type IdType = 'aadhaar' | 'passport';

export const PASSPORT_REGEX = /^[A-Z0-9]{6,15}$/;

/** Strips spaces / hyphens and upper-cases, so the same ID always compares equal. */
export function normalizeIdNumber(raw: string): string {
  return (raw || '').trim().replace(/[\s-]/g, '').toUpperCase();
}

export function idTypeOf(stored: string | null | undefined): IdType {
  return /^\d{12}$/.test(stored || '') || !stored ? 'aadhaar' : 'passport';
}

/** Returns an error message, or null when the ID number (Aadhaar or passport) is acceptable. */
export function validateIdNumber(idType: IdType, value: string): string | null {
  if (idType === 'passport') {
    if (!PASSPORT_REGEX.test(value)) {
      return 'Passport Number must be 6–15 letters/digits (as printed on the passport, no spaces).';
    }
    if (/^\d{12}$/.test(value)) {
      return 'A 12-digit number is an Aadhaar number — choose "Aadhaar" as the ID type.';
    }
    return null;
  }
  return validateAadhaar(value);
}
