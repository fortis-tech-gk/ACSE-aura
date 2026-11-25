import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PedHeat } from '@/lib/ped-session';
import { fmtDay, fmtTime, ordinal } from '@/lib/format';
import { Card, Muted, colors } from '@/components/ui';
import { heatTitle } from './PedAttendance';

export function PedResults({ data }: { data: { heats?: PedHeat[] } | null }) {
  if (!data?.heats) return <Muted style={{ textAlign: 'center', marginTop: 24 }}>Loading…</Muted>;
  if (!data.heats.length) {
    return (
      <Card>
        <Text style={s.title}>No results yet</Text>
        <Muted>Results of your athletes appear here as soon as each heat is finished. You also get a notification.</Muted>
      </Card>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      {data.heats.map((h) => (
        <Card key={h.heatId} style={{ gap: 6 }}>
          <Text style={s.title}>{heatTitle(h)}</Text>
          <Muted style={{ fontSize: 13 }}>
            {fmtDay(h.startAt)} · {fmtTime(h.startAt)}
          </Muted>
          {[...h.entries].sort((a, b) => (a.place ?? 999) - (b.place ?? 999)).map((e) => {
            const noShow = e.state !== 'REPORTED' && e.state !== 'NOT_REPORTED';
            const right = noShow ? e.state : e.mark || e.resultStatus || '—';
            return (
              <View key={e.heatAthleteId} style={s.row}>
                <Text style={s.place}>{e.place ? ordinal(e.place) : ''}</Text>
                <Text style={s.name} numberOfLines={2}>
                  {e.name}
                </Text>
                <Text style={[s.mark, noShow && { color: colors.red }]}>{right}</Text>
              </View>
            );
          })}
          {h.category === 'combined' ? <Muted style={{ fontSize: 12 }}>Decathlon / heptathlon points are on the public results page.</Muted> : null}
        </Card>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '900', color: colors.navy },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  place: { width: 36, fontWeight: '900', color: colors.goldDeep },
  name: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  mark: { fontWeight: '900', color: colors.navy, fontVariant: ['tabular-nums'] },
});
