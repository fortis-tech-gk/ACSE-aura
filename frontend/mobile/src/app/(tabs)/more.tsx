import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAthleteSession } from '@/lib/athlete-session';
import { MEET } from '@/lib/config';
import { VENUE, openVenueDirections } from '@/lib/venue';
import { AppHeader, Card, ListRow, Muted, Screen, colors, fonts } from '@/components/ui';

export default function MoreScreen() {
  const { me } = useAthleteSession();
  const meals = me?.meals.claimed.length ?? 0;
  return (
    <Screen header={<AppHeader eyebrow="AURA Athletes" title="More" />}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <ListRow icon="bed" title="Stay & Meals" subtitle={`${me?.hostel?.name || 'Accommodation details'} · ${meals}/4 meals today`} onPress={() => router.push('/stay')} />
        <View style={s.divider} />
        <ListRow icon="medal" title="Certificate" subtitle="Certificate of Participation — available after the meet" onPress={() => router.push('/certificate')} />
        <View style={s.divider} />
        <ListRow icon="location" title="Directions to venue" subtitle={`${VENUE.name}, Kambipura`} onPress={openVenueDirections} />
        <View style={s.divider} />
        <ListRow icon="settings" title="Settings" subtitle="Reminders, notifications, refresh, log out" onPress={() => router.push('/settings')} />
      </Card>

      <View style={s.meet}>
        <Text style={s.meetDr}>DR. ACS</Text>
        <Text style={s.meetAura}>AURA 2026</Text>
        <Muted style={s.meetText}>{MEET.subtitle}</Muted>
        <Muted style={s.meetText}>
          {MEET.dates} · {MEET.venue}
        </Muted>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 70 },
  meet: { alignItems: 'center', backgroundColor: colors.navy, borderRadius: 20, padding: 18, gap: 2, borderBottomWidth: 3, borderBottomColor: colors.gold },
  meetDr: { color: colors.goldBright, fontFamily: fonts.displayBold, fontSize: 12, letterSpacing: 5 },
  meetAura: { color: colors.goldBright, fontFamily: fonts.display, fontSize: 28, letterSpacing: 2 },
  meetText: { color: colors.onNavyMuted, textAlign: 'center', fontSize: 13 },
});
