import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useOfficialSession } from '@/lib/officials/session';
import type { QueuedScan } from '@/lib/officials/types';
import { fmtTime } from '@/lib/format';
import { AppHeader, Button, Card, Muted, Pill, Screen, Segmented, colors } from '@/components/ui';

const KIND: Record<QueuedScan['kind'], string> = { meal: 'Meal', checkin: 'Hostel check-in', accreditation: 'Accreditation', op: 'Entry' };
const MEAL: Record<string, string> = { BREAKFAST: 'Breakfast', LUNCH: 'Lunch', SNACKS: 'Snacks', DINNER: 'Dinner' };

type Filter = 'all' | 'pending' | 'rejected';

export default function ScanHistory() {
  const { queue, pendingCount, syncing, syncNow, lastSyncError, sessionExpired, rosterIndex } = useOfficialSession();
  const [filter, setFilter] = useState<Filter>(pendingCount ? 'pending' : 'all');

  const rejected = queue.filter((q) => q.status === 'rejected').length;
  const list = useMemo(() => {
    const l = filter === 'all' ? queue : queue.filter((q) => q.status === filter);
    return [...l].reverse().slice(0, 200);
  }, [queue, filter]);

  return (
    <Screen
      edges={['bottom']}
      refreshing={syncing}
      onRefresh={syncNow}
      maxWidth={860}
      header={<AppHeader back="Back" eyebrow="AURA Officials" title="Saved on this phone" subtitle="Scans and entries, and whether they reached the server" maxWidth={860} />}
    >

      <Card style={{ gap: 10 }}>
        <Text style={s.big}>
          {pendingCount ? `${pendingCount} waiting to be sent` : 'Everything is sent'}
        </Text>
        <Muted>
          {sessionExpired
            ? 'Your login has expired. Log in again and the saved scans will be sent.'
            : pendingCount
              ? lastSyncError
                ? `Last try: ${lastSyncError} The app keeps trying every 20 seconds.`
                : 'They are sent automatically as soon as there is internet.'
              : 'All scans reached the server.'}
        </Muted>
        {pendingCount > 0 && !sessionExpired && <Button title="Send now" onPress={syncNow} loading={syncing} />}
      </Card>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { key: 'all', label: `All (${queue.length})` },
          { key: 'pending', label: `Waiting (${pendingCount})` },
          { key: 'rejected', label: `Refused (${rejected})` },
        ]}
      />

      {list.length === 0 && (
        <Card>
          <Muted>Nothing here.</Muted>
        </Card>
      )}
      {list.map((q) => {
        const a = q.athleteId ? rosterIndex.byId.get(q.athleteId) : null;
        const who = q.op
          ? q.op.label
          : a
            ? `${a.name}${a.bib != null ? ` · Bib ${a.bib}` : ''}`
            : q.ref && 'bib' in q.ref
              ? `Bib ${q.ref.bib}`
              : 'Athlete not on saved list';
        return (
          <Card key={q.id} style={{ gap: 4 }}>
            <View style={s.row}>
              <Text style={s.kind}>
                {KIND[q.kind]}
                {q.mealType ? ` · ${MEAL[q.mealType]}` : ''}
              </Text>
              <Pill
                label={q.status === 'pending' ? 'Waiting' : q.status === 'ok' ? 'Sent' : 'Refused'}
                tone={q.status === 'pending' ? 'amber' : q.status === 'ok' ? 'green' : 'red'}
              />
            </View>
            <Text style={s.who} numberOfLines={1}>{who}</Text>
            <Muted style={{ fontSize: 12 }}>
              Scanned {fmtTime(q.scannedAt)}
              {q.message ? ` · ${q.message}` : ''}
            </Muted>
          </Card>
        );
      })}
    </Screen>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 20, fontWeight: '900', color: colors.navy },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kind: { fontSize: 15, fontWeight: '800', color: colors.text },
  who: { fontSize: 15, color: colors.text },
});
