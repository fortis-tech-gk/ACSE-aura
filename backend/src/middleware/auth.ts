import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';

const JWT_SECRET: string = process.env.JWT_SECRET || '';
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET environment variable is required. Set it in backend/.env');
  } else {
    console.warn('Warning: JWT_SECRET environment variable is not set. Using dev fallback.');
  }
}
const EFFECTIVE_JWT_SECRET: string = JWT_SECRET || 'vtu-athletics-dev-secret-change-in-production';

export type UserRole =
  | 'squad_manager'
  /** College PED in the athletes app: one login for both squads of the college */
  | 'ped'
  | 'meet_admin'
  | 'finance_desk'
  | 'accreditation_volunteer'
  | 'warden'
  | 'call_room_official'
  | 'referee'
  | 'spectator'
  | 'athlete'
  | 'food_volunteer';

export interface TokenPayload {
  role: UserRole;
  entityId: string; // squad.id or staff.id
  displayName: string;
  squadId?: string;
  collegeId?: string;
  gender?: 'men' | 'women';
  squadCode?: string;
  scopeEventIds?: string[];
  /** PED login: fingerprint of the squad password used — a password reset logs the PED out */
  pwv?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export function generateToken(payload: TokenPayload, expiresIn: '7d' | '21d' = '7d'): string {
  return jwt.sign(payload, EFFECTIVE_JWT_SECRET, { expiresIn });
}

/**
 * Returns the verified token payload, or null — never rejects the request.
 * Used by the rate limiter to key logged-in traffic per user instead of per IP.
 */
export function peekUser(req: Request): TokenPayload | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(h.slice(7), EFFECTIVE_JWT_SECRET) as unknown as TokenPayload;
  } catch {
    return null;
  }
}

// Staff tokens live up to 21 days: a deactivated account must stop working well before that.
// is_active is re-checked per staff account, cached for 30 s; a database hiccup never logs anyone out.
const NON_STAFF_ROLES = new Set<UserRole>(['athlete', 'ped', 'squad_manager', 'spectator']);
const STAFF_ACTIVE_TTL_MS = 30_000;
const staffActive = new Map<string, { active: boolean; at: number }>();

async function staffStillActive(staffId: string): Promise<boolean> {
  const hit = staffActive.get(staffId);
  if (hit && Date.now() - hit.at < STAFF_ACTIVE_TTL_MS) return hit.active;
  try {
    const { data, error } = await supabase.from('staff').select('is_active').eq('id', staffId).maybeSingle();
    if (error) return hit?.active ?? true;
    const active = data?.is_active === true; // a deleted account is inactive too
    staffActive.set(staffId, { active, at: Date.now() });
    return active;
  } catch {
    return hit?.active ?? true;
  }
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid.' });
  }

  const token = authHeader.split(' ')[1];
  let decoded: TokenPayload;
  try {
    decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET) as unknown as TokenPayload;
  } catch {
    return res.status(401).json({ error: 'Token is expired or invalid.' });
  }
  if (!NON_STAFF_ROLES.has(decoded.role) && decoded.entityId && !(await staffStillActive(decoded.entityId))) {
    return res.status(401).json({ error: 'This staff account has been deactivated. Ask the meet office.' });
  }
  req.user = decoded;
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: requires one of [${allowedRoles.join(', ')}] role.` });
    }

    next();
  };
}
