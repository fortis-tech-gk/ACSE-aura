/**
 * Login hero for both apps: the meet banner in miniature — ACS crest left, VTU seal right,
 * the meet line, and DR. ACS / AURA / 2026 in the ID card's gold display type.
 */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEET } from '@/lib/config';
import { colors, fonts } from './ui';

export function BrandHero({ app }: { app: 'ATHLETES' | 'OFFICIALS' }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.hero, { paddingTop: insets.top + 18 }]}>
      <View style={s.logos}>
        <Image source={require('../../assets/brand/acs-logo.png')} style={s.logo} accessibilityLabel="Dr. ACS College of Engineering" />
        <View style={s.lines}>
          <Text style={s.univ}>Visvesvaraya Technological University</Text>
          <Text style={s.meetLine}>VTU&apos;s 28th Inter-Collegiate Athletic Meet</Text>
        </View>
        <Image source={require('../../assets/brand/vtu-logo.png')} style={s.logo} accessibilityLabel="Visvesvaraya Technological University" />
      </View>

      <Text style={s.dr}>DR. ACS</Text>
      <Text style={s.aura} accessibilityRole="header">
        AURA
      </Text>
      <View style={s.yearRow}>
        <View style={s.rule} />
        <Text style={s.year}>2026</Text>
        <View style={s.rule} />
      </View>
      <View style={s.appTag}>
        <Text style={s.appTagText}>{app}</Text>
      </View>
      <Text style={s.dates}>
        {MEET.dates} · Bengaluru
      </Text>
      <View style={s.goldLine} />
    </View>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: colors.navy, paddingHorizontal: 18, paddingBottom: 54, alignItems: 'center' },
  logos: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  logo: { width: 46, height: 46, resizeMode: 'contain' },
  lines: { flex: 1, alignItems: 'center' },
  univ: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', textAlign: 'center' },
  meetLine: { color: colors.onNavyMuted, fontSize: 10.5, fontWeight: '600', textAlign: 'center', marginTop: 2 },
  dr: { marginTop: 22, color: colors.goldBright, fontFamily: fonts.displayBold, fontSize: 15, letterSpacing: 6 },
  aura: { color: colors.goldBright, fontFamily: fonts.display, fontSize: 64, lineHeight: 72, letterSpacing: 4 },
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rule: { width: 54, height: 1.5, backgroundColor: colors.gold },
  year: { color: '#fff', fontFamily: fonts.displayBold, fontSize: 15, letterSpacing: 6 },
  appTag: { marginTop: 14, borderWidth: 1, borderColor: colors.gold, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 4 },
  appTagText: { color: colors.goldBright, fontSize: 11, fontWeight: '900', letterSpacing: 3 },
  dates: { color: colors.onNavyMuted, fontSize: 12.5, marginTop: 10 },
  goldLine: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: colors.gold },
});
