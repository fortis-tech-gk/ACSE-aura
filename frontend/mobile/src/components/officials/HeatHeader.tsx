import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { HEAT_STATUS, stageLabel } from '@/lib/officials/heats';
import { Pill, colors } from '@/components/ui';

export function HeatHeader({
  data,
  right,
}: {
  data: { heat_number: number; stage: string; status: string; events: { name: string } };
  right?: React.ReactNode;
}) {
  const st = HEAT_STATUS[data.status] || HEAT_STATUS.SCHEDULED;
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/officials'))} accessibilityRole="button" hitSlop={12} style={{ alignSelf: 'flex-start' }}>
        <Text style={s.back}>‹ All heats</Text>
      </Pressable>
      <View style={s.row}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title}>{data.events.name}</Text>
          <Text style={s.sub}>{stageLabel(data.stage, data.heat_number)}</Text>
        </View>
        <Pill label={st.label} tone={st.tone} />
        {right}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  back: { color: colors.blue, fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 24, fontWeight: '900', color: colors.navy },
  sub: { fontSize: 15, fontWeight: '700', color: colors.muted },
});
