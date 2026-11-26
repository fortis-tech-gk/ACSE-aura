'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth-guard';
import { revalidatePath } from 'next/cache';
import { validateDateOfBirth } from '@/lib/eligibility';
import { validateIdNumber, normalizeIdNumber } from '@/lib/aadhaar';

/**
 * Executes the master registration lock and generates contiguous bid/chest numbers
 * across all colleges and squads.
 */
export async function closeRegistrationAction(): Promise<{ success: boolean; result?: any; error?: string }> {
  await requireAdmin();

  const { data, error } = await supabaseAdmin.rpc('close_registration_and_generate_bids');

  if (error) return { success: false, error: error.message };

  revalidatePath('/admin/bids');
  revalidatePath('/admin/amendments');
  revalidatePath('/admin/colleges');
  revalidatePath('/squad/dashboard');
  revalidatePath('/squad/athletes');

  return { success: true, result: data };
}

/**
 * Fetches the master bid block allocation overview across all squads.
 */
export async function getBidOverviewAction() {
  await requireAdmin();

  const { data: squads, error } = await supabaseAdmin
    .from('squads')
    .select(`
      id,
      squad_code,
      gender,
      bid_block_start,
      bid_block_end,
      payment_status,
      colleges (
        name,
        code,
        district,
        region
      ),
      profiles (
        id,
        sslc_name,
        usn,
        bid_number,
        accreditation_status
      )
    `)
    .order('squad_code', { ascending: true });

  if (error) throw new Error(error.message);
  return squads || [];
}

/**
 * Withdraws an athlete post-close and preserves their bid number gap.
 */
export async function withdrawAthleteAction(profileId: string, reason: string) {
  const admin = await requireAdmin();

  if (!reason?.trim()) {
    return { success: false, error: 'Reason for withdrawal is mandatory.' };
  }

  const { data, error } = await supabaseAdmin.rpc('withdraw_athlete', {
    p_profile_id: profileId,
    p_reason: reason.trim(),
    p_admin_id: admin.entityId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath('/admin/amendments');
  revalidatePath('/admin/bids');
  return { success: true, result: data };
}

const SUB_BLOOD_GROUPS = new Set(['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']);
const SUB_PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const SUB_PHOTO_MAX = 5 * 1024 * 1024;

/**
 * Substitutes a withdrawn athlete with a new athlete inheriting the same bid number AND the
 * withdrawn athlete's events (saved at withdrawal, migration 0046). Same identity checks as the
 * registration form: Aadhaar, date of birth, phone and a passport photo are required, so the
 * substitute has an ID-card photo and can log in to the Athletes app.
 */
export async function substituteAthleteAction(formData: FormData) {
  const admin = await requireAdmin();

  const withdrawnProfileId = formData.get('withdrawnProfileId') as string;
  const newName = (formData.get('newName') as string || '').trim();
  const newUsn = (formData.get('newUsn') as string || '').trim().toUpperCase();
  const newSemester = parseInt(formData.get('newSemester') as string, 10);
  const newBloodGroup = (formData.get('newBloodGroup') as string || '').trim();
  const newJoiningDate = formData.get('newJoiningDate') as string;
  const newSemStartDate = formData.get('newSemStartDate') as string;
  const newDob = (formData.get('newDateOfBirth') as string || '').trim();
  const newIdType = formData.get('newIdType') === 'passport' ? 'passport' : 'aadhaar';
  const newAadhaar = normalizeIdNumber(formData.get('newAadhaar') as string);
  let newPhone = String(formData.get('newPhone') || '').replace(/[\s-]/g, '');
  if (newPhone.startsWith('+91')) newPhone = newPhone.slice(3);
  else if (newPhone.length === 12 && newPhone.startsWith('91')) newPhone = newPhone.slice(2);
  else if (newPhone.length === 11 && newPhone.startsWith('0')) newPhone = newPhone.slice(1);
  const reason = (formData.get('reason') as string || '').trim();
  const photo = formData.get('photo') as File | null;

  if (!withdrawnProfileId || !newName || !newUsn || !reason) {
    return { success: false, error: 'All substitution fields are required.' };
  }
  if (!Number.isInteger(newSemester) || newSemester < 1 || newSemester > 10) {
    return { success: false, error: 'Semester must be between 1 and 10.' };
  }
  if (!SUB_BLOOD_GROUPS.has(newBloodGroup)) return { success: false, error: 'Please select a valid blood group.' };
  if (!newJoiningDate || !newSemStartDate) return { success: false, error: 'Joining date and present year start date are required.' };
  if (newSemStartDate < newJoiningDate) return { success: false, error: 'Present year start date cannot be earlier than the joining date.' };
  const dobError = validateDateOfBirth(newDob);
  if (dobError) return { success: false, error: dobError };
  const aadhaarError = validateIdNumber(newIdType, newAadhaar);
  if (aadhaarError) return { success: false, error: aadhaarError };
  if (!/^[6-9]\d{9}$/.test(newPhone)) return { success: false, error: "Enter the student's 10-digit mobile number." };
  if (!photo || typeof photo.arrayBuffer !== 'function' || photo.size === 0) {
    return { success: false, error: 'A passport-size photo (JPG, PNG or WebP, max 5MB) is mandatory.' };
  }
  const ext = SUB_PHOTO_TYPES[(photo.type || '').toLowerCase()];
  if (!ext) return { success: false, error: 'Invalid photo format. Only JPG, PNG and WebP images are permitted.' };
  if (photo.size > SUB_PHOTO_MAX) return { success: false, error: 'Photo size exceeds the maximum limit of 5MB.' };

  // Squad of the withdrawn slot (photo folder) and duplicate checks with a clear message
  const [{ data: slot }, { data: dupUsn }, { data: dupAadhaar }] = await Promise.all([
    supabaseAdmin.from('profiles').select('squad_id').eq('id', withdrawnProfileId).maybeSingle(),
    supabaseAdmin.from('profiles').select('id').eq('usn', newUsn).maybeSingle(),
    supabaseAdmin.from('profiles').select('id').eq('aadhaar_number', newAadhaar).maybeSingle(),
  ]);
  if (!slot) return { success: false, error: 'Withdrawn slot not found.' };
  if (dupUsn) return { success: false, error: 'This USN is already registered for another athlete in the championship.' };
  if (dupAadhaar) return { success: false, error: 'This Aadhaar / Passport number is already registered for another athlete in the championship.' };

  await supabaseAdmin.storage.createBucket('athlete-photos', { public: false }).catch(() => {});
  const path = `${slot.squad_id}/${Date.now()}_${newUsn}.${ext}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from('athlete-photos')
    .upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type.toLowerCase(), upsert: true });
  if (upErr) return { success: false, error: 'The athlete photo could not be uploaded. Please try again.' };
  const photoUrl = supabaseAdmin.storage.from('athlete-photos').getPublicUrl(path).data.publicUrl;

  const { data, error } = await supabaseAdmin.rpc('substitute_athlete', {
    p_withdrawn_profile_id: withdrawnProfileId,
    p_new_sslc_name: newName,
    p_new_usn: newUsn,
    p_new_semester: newSemester,
    p_new_blood_group: newBloodGroup,
    p_new_joining_date: newJoiningDate,
    p_new_sem_start_date: newSemStartDate,
    p_reason: reason,
    p_admin_id: admin.entityId,
    p_new_date_of_birth: newDob,
    p_new_phone: newPhone,
    p_new_aadhaar: newAadhaar,
    p_new_photo_url: photoUrl,
  });

  if (error) {
    await supabaseAdmin.storage.from('athlete-photos').remove([path]).catch(() => {});
    return { success: false, error: error.message };
  }

  revalidatePath('/admin/amendments');
  revalidatePath('/admin/bids');
  revalidatePath('/admin/athletes');
  return { success: true, result: data };
}

/**
 * Lists all post-close amendments.
 */
export async function listAmendmentsAction() {
  await requireAdmin();

  const { data: amendments, error } = await supabaseAdmin
    .from('roster_amendments')
    .select(`
      id,
      amendment_type,
      bid_number,
      reason,
      created_at,
      squads (
        squad_code,
        colleges (name)
      ),
      staff (
        display_name
      )
    `)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return amendments || [];
}
