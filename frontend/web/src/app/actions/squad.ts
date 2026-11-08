'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { requireSquad } from '@/lib/auth-guard';
import { revalidatePath } from 'next/cache';
import { getSession } from '@/lib/session';

export interface PedContact {
  pedName: string;
  pedPhone: string;
  pedEmail: string;
}

/**
 * Lets the college PED record / correct their contact details for this squad.
 * Contact details do not affect entries or fees, so this is allowed even when the
 * roster is locked (e.g. a PED changes phone number after payment).
 */
export async function updatePedContactAction(
  formData: FormData
): Promise<{ success: boolean; error?: string; contact?: PedContact }> {
  const session = await requireSquad();

  const pedName = (formData.get('pedName') as string || '').trim().replace(/\s+/g, ' ');
  const rawPhone = (formData.get('pedPhone') as string || '').trim();
  const pedEmail = (formData.get('pedEmail') as string || '').trim().toLowerCase();

  // Accept +91 / 0 prefixes and spaces/dashes; store the bare 10-digit mobile number
  let pedPhone = rawPhone.replace(/[\s()-]/g, '');
  if (pedPhone.startsWith('+91')) pedPhone = pedPhone.slice(3);
  else if (pedPhone.length === 12 && pedPhone.startsWith('91')) pedPhone = pedPhone.slice(2);
  else if (pedPhone.length === 11 && pedPhone.startsWith('0')) pedPhone = pedPhone.slice(1);

  if (pedName.length < 3 || pedName.length > 100) {
    return { success: false, error: 'Please enter the name of the Physical Education Director (3–100 characters).' };
  }
  if (!/^[6-9]\d{9}$/.test(pedPhone)) {
    return { success: false, error: 'Please enter a valid 10-digit Indian mobile number.' };
  }
  if (pedEmail && (pedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pedEmail))) {
    return { success: false, error: 'Please enter a valid email address, or leave it blank.' };
  }

  const { error } = await supabaseAdmin
    .from('squads')
    .update({
      ped_name: pedName,
      ped_phone: pedPhone,
      ped_email: pedEmail || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.squadId);

  if (error) return { success: false, error: error.message };

  revalidatePath('/squad/dashboard');
  revalidatePath('/squad/payment');
  revalidatePath('/squad/athletes');
  return { success: true, contact: { pedName, pedPhone, pedEmail } };
}

export interface CollegeDetails {
  collegeName: string;
  principalName: string;
  principalEmail: string;
  principalPhone: string;
}

const COLLEGE_MIGRATION_ERROR =
  'College details need database migration 0025 (supabase/migrations/0025_college_principal_details.sql). Please contact the VTU Directorate.';

/**
 * Principal's contact number as typed, minus spaces/dashes/brackets and a '+91' prefix.
 * A leading 0 is kept: '08134 251267' could be a landline with STD code or a mobile with a
 * 0 in front — they can't be told apart, so the number is stored exactly as given.
 */
function normalizeIndianPhone(raw: string): string {
  const v = raw.trim().replace(/[\s()-]/g, '');
  return v.startsWith('+91') ? v.slice(3) : v;
}

/**
 * Lets the college PED correct the college details: college name and the Principal's
 * name, email and contact number. Shared by the college's Men's and Women's squads.
 * These do not affect entries or fees, so editing is allowed even on a locked roster.
 */
export async function updateCollegeDetailsAction(
  formData: FormData
): Promise<{ success: boolean; error?: string; details?: CollegeDetails }> {
  const session = await requireSquad();

  const collegeName = (formData.get('collegeName') as string || '').trim().replace(/\s+/g, ' ');
  const principalName = (formData.get('principalName') as string || '').trim().replace(/\s+/g, ' ');
  const principalEmail = (formData.get('principalEmail') as string || '').trim().toLowerCase();
  const principalPhone = normalizeIndianPhone(formData.get('principalPhone') as string || '');

  if (collegeName.length < 5 || collegeName.length > 200) {
    return { success: false, error: 'Please enter the full name of the college (5–200 characters).' };
  }
  if (principalName.length < 3 || principalName.length > 100) {
    return { success: false, error: 'Please enter the name of the Principal (3–100 characters).' };
  }
  if (principalEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(principalEmail)) {
    return { success: false, error: 'Please enter a valid email ID of the Principal.' };
  }
  // 10-digit mobile, or a landline with STD code (10–12 digits, e.g. 08028437955)
  if (!/^[0-9]{10,12}$/.test(principalPhone)) {
    return { success: false, error: 'Please enter a valid contact number of the Principal (10-digit mobile or landline with STD code).' };
  }

  const { error } = await supabaseAdmin
    .from('colleges')
    .update({
      name: collegeName,
      principal_name: principalName,
      principal_email: principalEmail,
      principal_phone: principalPhone,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.collegeId);

  if (error) {
    const missing = /principal_/.test(error.message) && /(column|schema cache)/i.test(error.message);
    return { success: false, error: missing ? COLLEGE_MIGRATION_ERROR : error.message };
  }

  // Keep the college name shown in the portal header in sync without re-login
  try {
    const s = await getSession();
    if (s.isLoggedIn && s.collegeId === session.collegeId) {
      s.collegeName = collegeName;
      await s.save();
    }
  } catch {
    /* non-fatal */
  }

  revalidatePath('/squad', 'layout');
  return { success: true, details: { collegeName, principalName, principalEmail, principalPhone } };
}
