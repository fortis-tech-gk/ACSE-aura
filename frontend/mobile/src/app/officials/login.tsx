import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useOfficialSession } from '@/lib/officials/session';
import type { LoginRole } from '@/lib/officials/types';
import { ApiError } from '@/lib/api';
import { MEET } from '@/lib/config';
import { Button, Card, Muted, Screen, colors } from '@/components/ui';

const ROLES: { key: LoginRole; icon: string; title: string; sub: string }[] = [
  { key: 'food_volunteer', icon: '🍽️', title: 'Food counter', sub: 'Scan athletes at meals' },
  { key: 'warden', icon: '🏨', title: 'Hostel warden', sub: 'Check athletes into hostels' },
  { key: 'accreditation_volunteer', icon: '🪪', title: 'Accreditation desk', sub: 'Accredit athletes on arrival' },
  { key: 'call_room_official', icon: '🚪', title: 'Call room', sub: 'Check athletes in before their heat' },
  { key: 'referee', icon: '⏱️', title: 'Referee', sub: 'Enter times, distances and heights' },
];

export default function OfficialsLogin() {
  const { status, login, pendingCount } = useOfficialSession();
  const [role, setRole] = useState<LoginRole | null>(null);
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'signedIn') return <Redirect href="/officials" />;

  async function submit() {
    if (!role) return setError('Choose your duty first.');
    if (!/^\d{4,8}$/.test(pin)) return setError('Enter your 4–8 digit PIN.');
    setError(null);
    setLoading(true);
    try {
      await login(role, pin);
      router.replace('/officials');
    } catch (e) {
      setError(e instanceof ApiError ? (e.offline ? 'No internet. Logging in needs the network once; scanning then works offline.' : e.message) : 'Could not log in.');
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen maxWidth={560}>
        <View style={s.hero}>
          <Text style={s.brand}>AURA OFFICIALS</Text>
          <Text style={s.meet}>{MEET.name}</Text>
          <Text style={s.sub}>{MEET.dates}</Text>
        </View>

        <Text style={s.section}>Your duty</Text>
        <View style={{ gap: 10 }} accessibilityRole="radiogroup">
          {ROLES.map((r) => {
            const active = role === r.key;
            return (
              <Pressable
                key={r.key}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => setRole(r.key)}
                style={[s.role, active && s.roleActive]}
              >
                <Text style={{ fontSize: 28 }}>{r.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.roleTitle, active && { color: colors.blue }]}>{r.title}</Text>
                  <Muted style={{ fontSize: 13 }}>{r.sub}</Muted>
                </View>
                <View style={[s.radio, active && s.radioOn]} />
              </Pressable>
            );
          })}
        </View>

        <Card style={{ gap: 12 }}>
          <Text style={s.label} nativeID="pinLabel">PIN</Text>
          <TextInput
            accessibilityLabelledBy="pinLabel"
            accessibilityLabel="PIN"
            value={pin}
            onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
            placeholder="••••"
            placeholderTextColor="#94a3b8"
            onSubmitEditing={submit}
            style={s.pin}
          />
          {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
          <Button title="Log in" onPress={submit} loading={loading} />
          <Muted style={{ fontSize: 12 }}>Your PIN is given by the meet office. Scans keep working without internet after you log in.</Muted>
        </Card>

        {pendingCount > 0 && (
          <Card style={{ backgroundColor: colors.amberSoft, borderColor: colors.amberSoft }}>
            <Text style={{ color: colors.amber, fontWeight: '700' }}>
              {pendingCount} scan{pendingCount === 1 ? '' : 's'} saved on this device will be sent after you log in.
            </Text>
          </Card>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: colors.navy, borderRadius: 20, padding: 22, gap: 4 },
  brand: { color: colors.gold, fontWeight: '900', letterSpacing: 2, fontSize: 13 },
  meet: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 4 },
  sub: { color: '#c7d2fe', fontSize: 13 },
  section: { fontSize: 15, fontWeight: '800', color: colors.navy },
  role: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 16, borderWidth: 2, borderColor: colors.border, padding: 14 },
  roleActive: { borderColor: colors.blue, backgroundColor: '#f5f8ff' },
  roleTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border },
  radioOn: { borderColor: colors.blue, borderWidth: 7 },
  label: { fontSize: 14, fontWeight: '800', color: colors.text },
  pin: { minHeight: 56, borderWidth: 1, borderColor: colors.border, borderRadius: 12, fontSize: 28, letterSpacing: 10, textAlign: 'center', color: colors.text, backgroundColor: '#fff' },
  error: { color: colors.red, fontWeight: '700' },
});
