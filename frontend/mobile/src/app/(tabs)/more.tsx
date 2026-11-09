import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAthleteSession } from '@/lib/athlete-session';
import { MEET } from '@/lib/config';
import { VENUE, openVenueDirections } from '@/lib/venue';
import { Card, Muted, Screen, Title, colors } from '@/components/ui';

function Row({ icon, title, subtitle, onPress }: { icon: string; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
      <Text style={s.icon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{title}</Text>
        <Muted style={{ fontSize: 13 }}>{subtitle}</Muted>
      </View>
      <Text style={s.chev}>›</Text>
    </Pressable>
  );
}

export default function MoreScreen() {
  const { me } = useAthleteSession();
  const meals = me?.meals.claimed.length ?? 0;
  return (
    <Screen>
      <Title>More</Title>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Row
          icon="🏨"
          title="Stay & Meals"
          subtitle={`${me?.hostel?.name || 'Accommodation details'} · ${meals}/4 meals today`}
          onPress={() => router.push('/stay')}
        />
        <View style={s.divider} />
        <Row icon="📍" title="Directions to venue" subtitle={`${VENUE.name}, Kambipura`} onPress={openVenueDirections} />
        <View style={s.divider} />
        <Row icon="⚙️" title="Settings" subtitle="Reminders, notifications, refresh, log out" onPress={() => router.push('/settings')} />
      </Card>
      <Card style={{ gap: 4 }}>
        <Text style={s.title}>{MEET.name}</Text>
        <Muted>{MEET.subtitle}</Muted>
        <Muted>{MEET.dates} · {MEET.venue}</Muted>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  icon: { fontSize: 26 },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  chev: { fontSize: 28, color: colors.muted, fontWeight: '300' },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 56 },
});
