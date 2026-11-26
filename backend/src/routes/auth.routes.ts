import { Router, Request, Response } from 'express';
import { isLoginThrottled, recordLoginFailure, clearLoginFailures, THROTTLE_MESSAGE, PIN_FAILS_PER_ROLE_IP, PIN_FAILS_PER_IP } from '../utils/login-throttle';
import { supabase } from '../config/supabase';
import { generateToken } from '../middleware/auth';
import { verifyPassword } from '../utils/passphrase';
import { passwordFingerprint } from '../utils/passphrase';

export const authRouter = Router();

/**
 * POST /api/auth/squad/login
 * Body: { squadCode: string, passphrase: string }
 */
authRouter.post('/squad/login', async (req: Request, res: Response) => {
  try {
    const squadCode = (req.body.squadCode || '').trim().toUpperCase();
    const passphrase = (req.body.passphrase || '').trim();

    if (!squadCode || !passphrase) {
      return res.status(400).json({ error: 'Squad code and passphrase are required.' });
    }

    const { data: squad, error } = await supabase
      .from('squads')
      .select('id, college_id, gender, squad_code, passphrase_hash, colleges(id, name, code, district)')
      .eq('squad_code', squadCode)
      .single();

    if (error || !squad) {
      return res.status(401).json({ error: 'Invalid squad code or passphrase.' });
    }

    const isValid = await verifyPassword(passphrase, squad.passphrase_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid squad code or passphrase.' });
    }

    const college = Array.isArray(squad.colleges) ? squad.colleges[0] : squad.colleges;
    const collegeName = college?.name || squad.squad_code;

    const token = generateToken({
      role: 'squad_manager',
      entityId: squad.id,
      squadId: squad.id,
      collegeId: squad.college_id,
      gender: squad.gender as 'men' | 'women',
      squadCode: squad.squad_code,
      displayName: `${collegeName} (${squad.gender.toUpperCase()})`,
    });

    return res.json({
      success: true,
      token,
      squad: {
        id: squad.id,
        squadCode: squad.squad_code,
        gender: squad.gender,
        collegeId: squad.college_id,
        collegeName,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * POST /api/auth/ped/login   (AURA Athletes app — "Log in as PED")
 * Body: { collegeCode: string, passphrase: string }
 * One login for the whole college: the Men's OR the Women's squad passphrase opens both squads.
 * collegeCode may also be a squad code (e.g. ACSCE-M / ACSCE-W).
 */
authRouter.post('/ped/login', async (req: Request, res: Response) => {
  try {
    // Letters / digits / hyphens only, so input can never act as a wildcard in ilike
    let code = String(req.body?.collegeCode || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    const passphrase = String(req.body?.passphrase || '').trim();
    if (!code || !passphrase) {
      return res.status(400).json({ error: 'Enter your college code and the Men\'s or Women\'s password.' });
    }

    const ip = req.ip || 'unknown';
    const throttleKey = `ped|${code.replace(/-(M|W|G)$/, '')}`;
    if (await isLoginThrottled('squad', throttleKey, ip, 8, 500)) {
      return res.status(429).json({ error: THROTTLE_MESSAGE });
    }

    let { data: college } = await supabase.from('colleges').select('id, name, code').ilike('code', code).maybeSingle();
    if (!college) {
      // A squad code (ACSCE-M) or a college code with the Men / Women suffix
      const { data: squadByCode } = await supabase.from('squads').select('college_id').eq('squad_code', code).maybeSingle();
      let collegeId = squadByCode?.college_id || null;
      if (!collegeId && /-(M|W|G)$/.test(code)) {
        const base = code.replace(/-(M|W|G)$/, '');
        const { data: c2 } = await supabase.from('colleges').select('id').ilike('code', base).maybeSingle();
        collegeId = c2?.id || null;
      }
      if (collegeId) {
        const { data: c3 } = await supabase.from('colleges').select('id, name, code').eq('id', collegeId).maybeSingle();
        college = c3;
      }
    }

    const fail = async () => {
      await recordLoginFailure('squad', throttleKey, ip);
      return res.status(401).json({ error: 'Wrong college code or password. Use the Men\'s or the Women\'s registration password.' });
    };
    if (!college) return fail();

    const { data: squads } = await supabase.from('squads').select('id, gender, passphrase_hash').eq('college_id', college.id);
    // Issued passphrases are lowercase; tolerate an auto-capitalised first letter on phones
    const tries = Array.from(new Set([passphrase, passphrase.toLowerCase()]));
    let matched: string | null = null;
    for (const sq of squads || []) {
      for (const t of tries) {
        if (sq.passphrase_hash && (await verifyPassword(t, sq.passphrase_hash))) {
          matched = sq.passphrase_hash;
          break;
        }
      }
      if (matched) break;
    }
    if (!matched) return fail();
    await clearLoginFailures('squad', throttleKey);

    // 21 days: a PED who logs in a week before must not be logged out during the meet. The token
    // carries a fingerprint of the password used, so resetting that password logs the PED out.
    const token = generateToken(
      {
        role: 'ped',
        entityId: college.id,
        collegeId: college.id,
        squadCode: college.code,
        displayName: college.name,
        pwv: passwordFingerprint(matched),
      },
      '21d'
    );
    return res.json({
      success: true,
      token,
      college: { id: college.id, name: college.name, code: college.code },
      squads: (squads || []).map((s: any) => ({ id: s.id, gender: s.gender })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * POST /api/auth/staff/login
 * Body: { username: string, password: string }
 */
authRouter.post('/staff/login', async (req: Request, res: Response) => {
  try {
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const ip = req.ip || 'unknown';
    const userKey = username.toLowerCase();
    if (await isLoginThrottled('admin', userKey, ip, 8, 100)) {
      return res.status(429).json({ error: THROTTLE_MESSAGE });
    }

    const { data: staff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('username', username)
      .single();

    if (error || !staff) {
      await recordLoginFailure('admin', userKey, ip);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (!staff.is_active) {
      return res.status(403).json({ error: 'Account is deactivated.' });
    }

    if (!staff.password_hash) {
      return res.status(400).json({ error: 'This account signs in with a PIN.' });
    }
    const isValid = await verifyPassword(password, staff.password_hash);
    if (!isValid) {
      await recordLoginFailure('admin', userKey, ip);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    await clearLoginFailures('admin', userKey);

    const token = generateToken({
      role: staff.role,
      entityId: staff.id,
      displayName: staff.display_name,
    });

    return res.json({
      success: true,
      token,
      staff: {
        id: staff.id,
        username: staff.username,
        displayName: staff.display_name,
        role: staff.role,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/** Roles that sign in with a PIN (the scanner / officials apps). Admin and finance use passwords. */
const PIN_LOGIN_ROLES = new Set(['accreditation_volunteer', 'warden', 'call_room_official', 'referee', 'food_volunteer']);

/**
 * POST /api/auth/staff/pin-login
 * Body: { role: string, pin: string } — role is required (audit #10/#11)
 */
authRouter.post('/staff/pin-login', async (req: Request, res: Response) => {
  try {
    const role = (req.body.role || '').trim();
    const pin = (req.body.pin || '').trim();

    // The role is required: a PIN is only ever compared within one role. A role-less PIN was
    // bcrypt-checked against every staff account (slow — stalls the API) and the first match won.
    if (!PIN_LOGIN_ROLES.has(role)) {
      return res.status(400).json({ error: 'Choose your duty before entering the PIN.' });
    }
    // New PINs are 6–8 digits; older 4-digit PINs still log in until they are re-issued
    if (!/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ error: 'Enter your PIN (digits only).' });
    }

    // Throttle per role + network, plus an overall cap per IP. At the venue every official shares
    // ONE public IP, so these are venue-scale (audit 26 Nov: 15/30 let 30 typos across any roles lock
    // every official out for 15 minutes). A correct PIN clears the role's counter.
    const ip = req.ip || 'unknown';
    const pinKey = `${role}|${ip}`;
    if (await isLoginThrottled('pin', pinKey, ip, PIN_FAILS_PER_ROLE_IP, PIN_FAILS_PER_IP)) {
      return res.status(429).json({ error: THROTTLE_MESSAGE });
    }

    const query = supabase
      .from('staff')
      .select('id, pin_hash, display_name, role, scope_event_ids, is_active')
      .eq('is_active', true)
      .eq('role', role)
      .not('pin_hash', 'is', null);

    const { data: candidates, error } = await query;

    if (error || !candidates || candidates.length === 0) {
      return res.status(401).json({ error: 'Invalid PIN or unauthorized role.' });
    }

    let matchedStaff = null;
    for (const c of candidates) {
      if (c.pin_hash && (await verifyPassword(pin, c.pin_hash))) {
        matchedStaff = c;
        break;
      }
    }

    if (!matchedStaff) {
      await recordLoginFailure('pin', pinKey, ip);
      return res.status(401).json({ error: 'Invalid PIN.' });
    }
    await clearLoginFailures('pin', pinKey);

    // 21 days, so scanner phones set up before the meet stay logged in for all of it
    // (an expired login stops saved scans from being sent until someone logs in again).
    const token = generateToken(
      {
        role: matchedStaff.role,
        entityId: matchedStaff.id,
        displayName: matchedStaff.display_name,
        scopeEventIds: matchedStaff.scope_event_ids || [],
      },
      '21d'
    );

    return res.json({
      success: true,
      token,
      staff: {
        id: matchedStaff.id,
        displayName: matchedStaff.display_name,
        role: matchedStaff.role,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});
