import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';

const ADJECTIVES = [
  'swift', 'bold', 'brave', 'sharp', 'rapid', 'stellar', 'golden', 'silver',
  'mighty', 'noble', 'agile', 'prime', 'blazing', 'zenith', 'apex', 'vivid',
  'iron', 'falcon', 'titan', 'stellar', 'radiant', 'dynamic', 'crest', 'beacon'
];

const NOUNS = [
  'runner', 'stride', 'track', 'sprint', 'hurdle', 'relay', 'jumper', 'thrower',
  'champion', 'falcon', 'tiger', 'leopard', 'panther', 'eagle', 'storm', 'victory',
  'stadium', 'flame', 'medal', 'record', 'spirit', 'shield', 'stride', 'vector'
];

export function generateSquadPassphrase(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${adj}-${noun}-${num}`;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Short fingerprint of a stored password hash (PED tokens carry it): when the password is reset
 * the hash changes, the fingerprint no longer matches, and the old token stops working.
 */
export function passwordFingerprint(storedHash: string): string {
  return createHash('sha256').update(String(storedHash)).digest('hex').slice(0, 16);
}
