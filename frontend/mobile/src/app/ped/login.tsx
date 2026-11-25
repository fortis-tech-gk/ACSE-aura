import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';
import { router } from 'expo-router';
import { usePedSession } from '@/lib/ped-session';
import { ApiError } from '@/lib/api';
import { BrandHero } from '@/components/BrandHero';
import { Button, Card, Icon, Muted, colors, styles as ui } from '@/components/ui';

export default function PedLoginScreen() {
  const { login } = usePedSession();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passRef = useRef<TextInputInstance>(null);

  async function submit() {
    setError(null);
    if (!code.trim()) return setError('Enter your college code.');
    if (!password.trim()) return setError("Enter the Men's or the Women's password.");
    setLoading(true);
    try {
      await login(code.trim(), password.trim());
      router.replace('/ped');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <BrandHero app="ATHLETES" />

        <View style={s.body}>
          <Card style={s.form}>
            <Text style={s.formTitle}>PED log in</Text>
            <Muted style={{ marginTop: -6 }}>
              Use the college code and password from the registration website. The Men&apos;s or the Women&apos;s password works — one login covers both squads.
            </Muted>

            <View>
              <Text style={ui.fieldLabel} nativeID="codeLabel">
                College code
              </Text>
              <TextInput
                accessibilityLabelledBy="codeLabel"
                value={code}
                onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passRef.current?.focus()}
                placeholder="e.g. ACSCE"
                placeholderTextColor="#b4b9c4"
                style={[ui.field, s.input]}
              />
            </View>

            <View>
              <Text style={ui.fieldLabel} nativeID="passLabel">
                Password (Men or Women)
              </Text>
              <TextInput
                ref={passRef}
                accessibilityLabelledBy="passLabel"
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={submit}
                placeholder="e.g. swift-falcon-84"
                placeholderTextColor="#b4b9c4"
                style={[ui.field, s.input]}
              />
            </View>

            {error && (
              <View style={s.error} accessibilityRole="alert">
                <Icon name="warning" size={18} color={colors.red} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <Button title="Log in" variant="gold" onPress={submit} loading={loading} />
          </Card>

          <Button title="I am an athlete" icon="back" variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: 16, gap: 12, marginTop: -30, width: '100%', maxWidth: 520, alignSelf: 'center' },
  form: { gap: 16, padding: 20 },
  formTitle: { fontSize: 22, fontWeight: '900', color: colors.navy },
  input: { fontSize: 18, fontWeight: '800', color: colors.navy },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.redSoft, borderRadius: 12, padding: 12 },
  errorText: { flex: 1, color: colors.red, fontWeight: '700', lineHeight: 20 },
});
