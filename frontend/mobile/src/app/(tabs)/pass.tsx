import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { useAthleteSession } from '@/lib/athlete-session';
import { fmtDay, fmtTime, minutesUntil, stageLabel } from '@/lib/format';
import { isRemindable } from '@/lib/reminders';
import { AppHeader, Card, Icon, Muted, OfflineBanner, Pill, Screen, SectionLabel, colors, fonts, shadow, useNow } from '@/components/ui';

export default function PassScreen() {
  const { me, refreshing, refresh, offline, lastSyncedAt } = useAthleteSession();
  const now = useNow();
  if (!me) {
    return (
      <Screen header={<AppHeader eyebrow="AURA Athletes" title="My Pass" />}>
        <Muted>Loading your pass…</Muted>
      </Screen>
    );
  }
  const a = me.athlete;
  const accredited = a.accreditationStatus === 'ACCREDITED';
  const next = me.schedule.find((e) => isRemindable(e) && e.callRoomAt && new Date(e.callRoomAt).getTime() > now - 30 * 60000);
  const mins = next ? minutesUntil(next.callRoomAt) : null;
  const firstName = a.name.split(' ')[0];

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={refresh}
      header={<AppHeader eyebrow="AURA Athletes" title={`Hi, ${firstName.charAt(0)}${firstName.slice(1).toLowerCase()}`} subtitle="Your pass for Dr. ACS AURA 2026" />}
    >
      <OfflineBanner offline={offline} lastSyncedAt={lastSyncedAt} />

      {/* Digital ID card */}
      <View style={s.card}>
        <View style={s.cardTop}>
          <Image source={require('../../../assets/brand/acs-logo.png')} style={s.logo} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.cardDr}>DR. ACS</Text>
            <Text style={s.cardAura}>AURA 2026</Text>
          </View>
          <Image source={require('../../../assets/brand/vtu-logo.png')} style={s.logo} />
        </View>
        <View style={s.cardGold} />

        <View style={s.identity}>
          {a.photoUrl ? (
            <Image source={{ uri: a.photoUrl }} style={s.photo} accessibilityLabel={`Photo of ${a.name}`} />
          ) : (
            <View style={[s.photo, s.photoEmpty]}>
              <Icon name="person" size={44} color={colors.muted} />
            </View>
          )}
          <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
            <View style={s.roleTag}>
              <Text style={s.roleText}>ATHLETE</Text>
            </View>
            <Text style={s.name} numberOfLines={2}>
              {a.name}
            </Text>
            <Text style={s.college} numberOfLines={2}>
              {a.college?.name}
            </Text>
          </View>
        </View>

        <View style={s.bibRow}>
          <View style={s.bib}>
            <Text style={s.bibLabel}>BIB NUMBER</Text>
            <Text style={s.bibValue} accessibilityLabel={`Bib number ${a.bibNumber ?? 'not assigned'}`}>
              {a.bibNumber ?? '—'}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <Meta label="USN" value={a.usn} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Meta label="Division" value={a.gender === 'women' ? 'Women' : 'Men'} />
              <Meta label="Blood" value={a.bloodGroup || '—'} />
            </View>
          </View>
        </View>

        <View style={s.cardFoot}>
          <Pill label={accredited ? 'Accredited' : 'Not yet accredited'} icon={accredited ? 'verified' : 'info'} tone={accredited ? 'green' : 'amber'} />
          <Text style={s.footDates}>07 – 10 DEC 2026</Text>
        </View>
      </View>

      {next && (
        <>
          <SectionLabel>Next call room</SectionLabel>
          <Pressable onPress={() => router.push('/events')} accessibilityRole="button" style={({ pressed }) => [s.next, pressed && { opacity: 0.9 }]}>
            <View style={s.nextTime}>
              <Text style={s.nextTimeLabel}>REPORT BY</Text>
              <Text style={s.nextTimeValue}>{fmtTime(next.callRoomAt)}</Text>
              <Text style={s.nextTimeDay}>{fmtDay(next.callRoomAt)}</Text>
            </View>
            <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
              <Text style={s.nextEvent} numberOfLines={2}>
                {next.eventName}
              </Text>
              <Muted style={{ fontSize: 13 }}>
                {[stageLabel(next.stage), next.heatNumber ? `Heat ${next.heatNumber}` : '', next.lane ? `Lane ${next.lane}` : ''].filter(Boolean).join(' · ') || 'Heat to be announced'}
                {next.callRoomEstimated ? ' · approx.' : ''}
              </Muted>
              {mins !== null && (
                <Pill
                  label={mins > 0 ? `in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}` : 'Call room time now'}
                  icon="clock"
                  tone={mins <= 10 ? 'red' : mins <= 30 ? 'amber' : 'gold'}
                />
              )}
            </View>
            <Icon name="chevron" size={22} color={colors.muted} />
          </Pressable>
        </>
      )}

      <SectionLabel>Scan code</SectionLabel>
      <Card style={{ alignItems: 'center', gap: 12 }}>
        <View style={s.qrWrap}>
          <QRCode value={a.qrToken} size={200} ecl="M" color={colors.navy} />
        </View>
        <Muted style={{ textAlign: 'center' }}>Show this at meals, the hostel and the call room. Your printed ID card has the same code.</Muted>
      </Card>
    </Screen>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fffdf7', borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: '#e6d8b4', ...shadow },
  cardTop: { backgroundColor: colors.navy, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 10 },
  logo: { width: 38, height: 38, resizeMode: 'contain' },
  cardDr: { color: colors.goldBright, fontFamily: fonts.displayBold, fontSize: 11, letterSpacing: 4 },
  cardAura: { color: colors.goldBright, fontFamily: fonts.display, fontSize: 22, letterSpacing: 2 },
  cardGold: { height: 3, backgroundColor: colors.gold },
  identity: { flexDirection: 'row', gap: 14, padding: 16, paddingBottom: 10, alignItems: 'center' },
  photo: { width: 96, height: 118, borderRadius: 14, backgroundColor: '#eee', borderWidth: 2.5, borderColor: colors.gold },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  roleTag: { alignSelf: 'flex-start', backgroundColor: colors.goldSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  roleText: { color: colors.goldDeep, fontSize: 10, fontWeight: '900', letterSpacing: 3 },
  name: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, color: colors.navy },
  college: { fontSize: 12, fontWeight: '700', color: colors.text, textTransform: 'uppercase', letterSpacing: 0.4 },
  bibRow: { flexDirection: 'row', gap: 14, paddingHorizontal: 16, alignItems: 'center' },
  bib: { width: 120, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.gold },
  bibLabel: { backgroundColor: colors.navy, color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 2.5, textAlign: 'center', paddingVertical: 3 },
  bibValue: { color: colors.navy, fontFamily: fonts.display, fontSize: 34, textAlign: 'center', paddingVertical: 2 },
  metaLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  metaValue: { color: colors.text, fontSize: 14, fontWeight: '800' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 14 },
  footDates: { fontFamily: fonts.displayBold, fontSize: 12, color: colors.navy, letterSpacing: 1 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 12, ...shadow },
  nextTime: { width: 92, backgroundColor: colors.navy, borderRadius: 14, paddingVertical: 10, alignItems: 'center' },
  nextTimeLabel: { color: colors.onNavyMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  nextTimeValue: { color: colors.goldBright, fontSize: 19, fontWeight: '900', marginTop: 2 },
  nextTimeDay: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 1 },
  nextEvent: { fontSize: 17, fontWeight: '900', color: colors.navy },
  qrWrap: { padding: 14, backgroundColor: '#fff', borderRadius: 18, borderWidth: 2, borderColor: colors.goldSoft },
});
