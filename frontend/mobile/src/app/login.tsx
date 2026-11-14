import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { router } from 'expo-router';
import { useAthleteSession } from '@/lib/athlete-session';
import { ApiError } from '@/lib/api';
import { openVenueDirections } from '@/lib/venue';
import { toIsoDate } from '@/lib/format';
import { BrandHero } from '@/components/BrandHero';
import { Button, Card, Icon, Muted, colors, styles as ui } from '@/components/ui';

export default function LoginScreen() {
  const { login } = useAthleteSession();
  const [bib, setBib] = useState('');
  const [dd, setDd] = useState('');
  const [mm, setMm] = useState('');
  const [yyyy, setYyyy] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mmRef = useRef<TextInputInstance>(null);
  const yyyyRef = useRef<TextInputInstance>(null);
  const ddRef = useRef<TextInputInstance>(null);

  async function submit() {
    setError(null);
    if (!/^\d{1,5}$/.test(bib.trim())) return setError('Enter your bib number (digits only).');
    const dob = toIsoDate(dd, mm, yyyy);
    if (!dob) return setError('Enter your date of birth as DD / MM / YYYY.');
    setLoading(true);
    try {
      await login({ bib: bib.trim(), dob });
      router.replace('/pass');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const digits = (v: string) => v.replace(/\D/g, '');

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <BrandHero app="ATHLETES" />

        <View style={s.body}>
          <Card style={s.form}>
            <Text style={s.formTitle}>Sign in</Text>
            <Muted style={{ marginTop: -6 }}>Your bib number is printed on your ID card.</Muted>

            <View>
              <Text style={ui.fieldLabel} nativeID="bibLabel">
                Bib number
              </Text>
              <TextInput
                accessibilityLabelledBy="bibLabel"
                value={bib}
                onChangeText={(v) => setBib(digits(v).slice(0, 5))}
                keyboardType="number-pad"
                returnKeyType="next"
                onSubmitEditing={() => ddRef.current?.focus()}
                placeholder="e.g. 105"
                placeholderTextColor="#b4b9c4"
                style={[ui.field, s.bibInput]}
                maxLength={5}
              />
            </View>

            <View>
              <Text style={ui.fieldLabel} nativeID="dobLabel">
                Date of birth (as per SSLC)
              </Text>
              <View style={s.dobRow}>
                <TextInput
                  ref={ddRef}
                  accessibilityLabel="Day of birth"
                  value={dd}
                  onChangeText={(v) => {
                    const x = digits(v).slice(0, 2);
                    setDd(x);
                    if (x.length === 2) mmRef.current?.focus();
                  }}
                  keyboardType="number-pad"
                  placeholder="DD"
                  placeholderTextColor="#b4b9c4"
                  style={[ui.field, s.dobBox]}
                  maxLength={2}
                />
                <Text style={s.slash}>/</Text>
                <TextInput
                  ref={mmRef}
                  accessibilityLabel="Month of birth"
                  value={mm}
                  onChangeText={(v) => {
                    const x = digits(v).slice(0, 2);
                    setMm(x);
                    if (x.length === 2) yyyyRef.current?.focus();
                  }}
                  keyboardType="number-pad"
                  placeholder="MM"
                  placeholderTextColor="#b4b9c4"
                  style={[ui.field, s.dobBox]}
                  maxLength={2}
                />
                <Text style={s.slash}>/</Text>
                <TextInput
                  ref={yyyyRef}
                  accessibilityLabel="Year of birth"
                  value={yyyy}
                  onChangeText={(v) => setYyyy(digits(v).slice(0, 4))}
                  keyboardType="number-pad"
                  placeholder="YYYY"
                  placeholderTextColor="#b4b9c4"
                  style={[ui.field, s.dobBox, { flex: 1.6 }]}
                  maxLength={4}
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
              </View>
            </View>

            {error && (
              <View style={s.error} accessibilityRole="alert">
                <Icon name="warning" size={18} color={colors.red} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <Button title="Log in" variant="gold" onPress={submit} loading={loading} />

            <View style={s.orRow}>
              <View style={s.line} />
              <Text style={s.or}>or</Text>
              <View style={s.line} />
            </View>

            <Button title="Scan the QR on my ID card" icon="qr" variant="secondary" onPress={() => router.push('/scan')} />
          </Card>

          <Button title="Directions to the venue" icon="location" variant="ghost" onPress={openVenueDirections} />

          <Muted style={{ textAlign: 'center', fontSize: 12.5 }}>
            If your date of birth is not accepted, ask your college PED to check it on the registration portal.
          </Muted>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, gap: 12, marginTop: -30, width: '100%', maxWidth: 520, alignSelf: 'center' },
  form: { gap: 16, padding: 20 },
  formTitle: { fontSize: 22, fontWeight: '900', color: colors.navy },
  bibInput: { fontSize: 26, fontWeight: '900', letterSpacing: 3, color: colors.navy },
  dobRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dobBox: { flex: 1, flexBasis: 0, minWidth: 0, textAlign: 'center', fontSize: 18, fontWeight: '800', color: colors.text, paddingHorizontal: 6 },
  slash: { fontSize: 20, color: colors.muted },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.redSoft, borderRadius: 12, padding: 12 },
  errorText: { flex: 1, color: colors.red, fontWeight: '700', lineHeight: 20 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { color: colors.muted, fontWeight: '700' },
});
