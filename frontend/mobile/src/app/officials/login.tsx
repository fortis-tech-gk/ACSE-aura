import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOfficialSession } from '@/lib/officials/session';
import type { LoginRole } from '@/lib/officials/types';
import { ApiError } from '@/lib/api';
import { BrandHero } from '@/components/BrandHero';
import { Button, Card, Icon, Muted, Select, colors, styles as ui, type SelectOption } from '@/components/ui';

const ROLES: SelectOption<LoginRole>[] = [
  { value: 'referee', label: 'Referee', sub: 'Times, distances and heights', icon: 'timer' },
  { value: 'call_room_official', label: 'Call room', sub: 'Check athletes in before their heat', icon: 'door' },
  { value: 'accreditation_volunteer', label: 'Accreditation desk', sub: 'Check in each college on arrival', icon: 'verified' },
  { value: 'warden', label: 'Hostel warden', sub: 'Check athletes into hostels', icon: 'bed' },
  { value: 'food_volunteer', label: 'Food counter', sub: 'Scan athletes at meals', icon: 'food' },
];

/** The duty picked last time on this phone — officials usually keep the same duty all meet */
const LAST_ROLE_KEY = '@aura/off-last-role';

export default function OfficialsLogin() {
  const { status, login, pendingCount } = useOfficialSession();
  const [role, setRole] = useState<LoginRole | null>(null);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(LAST_ROLE_KEY)
      .then((v) => {
        if (v && ROLES.some((r) => r.value === v)) setRole((cur) => cur ?? (v as LoginRole));
      })
      .catch(() => {});
  }, []);

  if (status === 'signedIn') return <Redirect href="/officials" />;

  async function submit() {
    if (!role) return setError('Choose your duty first.');
    if (!/^\d{4,8}$/.test(pin)) return setError('Enter your PIN (4–8 digits).');
    setError(null);
    setLoading(true);
    try {
      await login(role, pin);
      AsyncStorage.setItem(LAST_ROLE_KEY, role).catch(() => {});
      router.replace('/officials');
    } catch (e) {
      setError(e instanceof ApiError ? (e.offline ? 'No internet. Logging in needs the network once; scanning then works offline.' : e.message) : 'Could not log in.');
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <BrandHero app="OFFICIALS" />

        <View style={s.body}>
          <Card style={s.form}>
            <Text style={s.formTitle}>Sign in</Text>
            <Muted style={{ marginTop: -6 }}>Use the PIN given to you by the meet office.</Muted>

            <Select label="Duty" value={role} options={ROLES} onChange={(v) => { setRole(v); setError(null); }} placeholder="Choose your duty" />

            <View>
              <Text style={ui.fieldLabel} nativeID="pinLabel">
                PIN
              </Text>
              <View style={[ui.field, s.pinField]}>
                <Icon name="lock" size={20} color={colors.muted} />
                <TextInput
                  accessibilityLabelledBy="pinLabel"
                  accessibilityLabel="PIN"
                  value={pin}
                  onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={8}
                  placeholder="••••••"
                  placeholderTextColor="#b4b9c4"
                  onSubmitEditing={submit}
                  returnKeyType="go"
                  style={s.pin}
                />
              </View>
            </View>

            {!!error && (
              <View style={s.error} accessibilityRole="alert">
                <Icon name="warning" size={18} color={colors.red} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <Button title="Log in" variant="gold" onPress={submit} loading={loading} />
          </Card>

          {pendingCount > 0 && (
            <View style={s.pending}>
              <Icon name="history" size={18} color={colors.amber} />
              <Text style={s.pendingText}>
                {pendingCount} scan{pendingCount === 1 ? '' : 's'} saved on this phone will be sent after you log in.
              </Text>
            </View>
          )}

          <Muted style={{ textAlign: 'center', fontSize: 12 }}>Scans keep working without internet after you log in.</Muted>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, gap: 14, marginTop: -30, width: '100%', maxWidth: 520, alignSelf: 'center' },
  form: { gap: 16, padding: 20 },
  formTitle: { fontSize: 22, fontWeight: '900', color: colors.navy },
  pinField: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pin: { flex: 1, minWidth: 0, fontSize: 24, fontWeight: '800', letterSpacing: 8, color: colors.text, paddingVertical: 10 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.redSoft, borderRadius: 12, padding: 12 },
  errorText: { flex: 1, color: colors.red, fontWeight: '700' },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.amberSoft, borderRadius: 14, padding: 12 },
  pendingText: { flex: 1, color: colors.amber, fontWeight: '700' },
});
