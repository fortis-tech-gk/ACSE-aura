import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HEAT_STATUS, stageLabel } from '@/lib/officials/heats';
import { Pill, colors } from '@/components/ui';

/** Status strip under the screen header (the header already shows the event and round) */
export function HeatHeader({
  data,
  right,
}: {
  data: { heat_number: number; stage: string; status: string; events: { name: string } };
  right?: React.ReactNode;
}) {
  const st = HEAT_STATUS[data.status] || HEAT_STATUS.SCHEDULED;
  return (
    <View style={s.row} accessibilityLabel={`${data.events.name}, ${stageLabel(data.stage, data.heat_number)}: ${st.label}`}>
      <Text style={s.label}>STATUS</Text>
      <Pill label={st.label} tone={st.tone} />
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontSize: 11, fontWeight: '900', color: colors.goldDeep, letterSpacing: 1.4 },
});
