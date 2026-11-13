/**
 * Digital copies of the Athletics Federation of India score sheets (docs/score-sheet.pdf):
 * the same header block, title banner, ruled grid and signature footer, so a referee fills
 * the screen exactly like the paper card. Wide sheets scroll sideways on phones.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { MEET } from '@/lib/config';
import { fmtDay, fmtTime } from '@/lib/format';
import { colors } from '@/components/ui';

const INK = '#111827';
const RULE = '#374151';
export const SHADE = '#e5e7eb';

/** Header used on every sheet: Event Name / Venue & Date / Organised by, then the title banner */
export function SheetTitle({ title }: { title: string }) {
  return (
    <View style={s.titleWrap}>
      <Text style={s.federation}>ATHLETICS FEDERATION OF INDIA</Text>
      <View style={s.metaBlock}>
        <Text style={s.meta}>
          <Text style={s.metaKey}>Event Name: </Text>
          {MEET.subtitle} ({MEET.name})
        </Text>
        <Text style={s.meta}>
          <Text style={s.metaKey}>Venue & Date: </Text>
          {MEET.venue} · {MEET.dates}
        </Text>
        <Text style={s.meta}>
          <Text style={s.metaKey}>Organised by: </Text>
          Visvesvaraya Technological University, Belagavi
        </Text>
      </View>
      <View style={s.banner}>
        <Text style={s.bannerText}>{title}</Text>
      </View>
    </View>
  );
}

const STAGE_TEXT: Record<string, string> = { HEATS: 'HEAT', SEMI_FINAL: 'SEMI-FINAL', FINAL: 'FINAL', QUALIFYING: 'QUALIFYING' };
const GROUP: Record<string, string> = { men: 'MEN', women: 'WOMEN', mixed: 'MIXED' };

export type SheetHeat = {
  heat_number: number;
  stage: string;
  events: { name: string; code: string; gender?: string | null };
};

/** EVENT No. / EVENT / DATE / GROUP / TIME Hrs. / HEAT No. – SEMI-FINAL – FINAL boxes */
export function SheetInfo({ heat, startAt, extra }: { heat: SheetHeat; startAt?: string | null; extra?: React.ReactNode }) {
  const stage = STAGE_TEXT[heat.stage] || heat.stage;
  return (
    <View style={s.info}>
      <InfoBox label="EVENT No." value={heat.events.code} />
      <InfoBox label="EVENT" value={heat.events.name.toUpperCase()} grow={2} />
      <InfoBox label="DATE" value={startAt ? fmtDay(startAt) : ''} />
      <InfoBox label="GROUP" value={GROUP[heat.events.gender || ''] || ''} />
      <InfoBox label="TIME Hrs." value={startAt ? fmtTime(startAt) : ''} />
      <View style={[s.infoBox, { flexGrow: 2 }]}>
        <Text style={s.infoLabel}>HEAT No. / SEMI-FINAL / FINAL</Text>
        <Text style={s.infoValue}>
          {['HEAT', 'SEMI-FINAL', 'FINAL'].map((k, i) => (
            <Text key={k}>
              {i ? <Text style={s.stageOff}>{'  /  '}</Text> : null}
              <Text style={stage === k ? s.stageOn : s.stageOff}>
                {k}
                {stage === k && k !== 'FINAL' ? ` ${heat.heat_number}` : ''}
              </Text>
            </Text>
          ))}
          {!['HEAT', 'SEMI-FINAL', 'FINAL'].includes(stage) ? `  ${stage} ${heat.heat_number}` : ''}
        </Text>
      </View>
      {extra}
    </View>
  );
}

function InfoBox({ label, value, grow = 1 }: { label: string; value: string; grow?: number }) {
  return (
    <View style={[s.infoBox, { flexGrow: grow }]}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1}>
        {value || ' '}
      </Text>
    </View>
  );
}

export type Col = { key: string; title: string; width: number; sub?: string };

/** A ruled table: optional group row above the column titles, then the rows. Scrolls sideways. */
export function SheetGrid({ groups, cols, children }: { groups?: { title: string; span: number }[]; cols: Col[]; children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
      <View style={s.grid}>
        {groups && (
          <View style={s.row}>
            {groups.map((g, i) => {
              const start = groups.slice(0, i).reduce((n, x) => n + x.span, 0);
              const w = cols.slice(start, start + g.span).reduce((n, c) => n + c.width, 0);
              return (
                <View key={i} style={[s.head, { width: w }]}>
                  <Text style={s.headText}>{g.title}</Text>
                </View>
              );
            })}
          </View>
        )}
        <View style={s.row}>
          {cols.map((c) => (
            <View key={c.key} style={[s.head, { width: c.width }]}>
              <Text style={s.headText}>{c.title}</Text>
              {!!c.sub && <Text style={s.headSub}>{c.sub}</Text>}
            </View>
          ))}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

export function SheetRow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.row, style]}>{children}</View>;
}

/** One ruled cell. Pressable when `onPress` is set; `selected` draws the active-cell outline. */
export function Cell({
  width,
  text,
  children,
  onPress,
  selected,
  shaded,
  align = 'center',
  textStyle,
  label,
}: {
  width: number;
  text?: string | number | null;
  children?: React.ReactNode;
  onPress?: () => void;
  selected?: boolean;
  shaded?: boolean;
  align?: 'left' | 'center';
  textStyle?: StyleProp<TextStyle>;
  label?: string;
}) {
  const body = children ?? (
    <Text style={[s.cellText, align === 'left' && { textAlign: 'left' }, textStyle]} numberOfLines={2}>
      {text ?? ''}
    </Text>
  );
  const style = [s.cell, { width }, shaded && { backgroundColor: SHADE }, selected && s.cellSel];
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={style} accessibilityRole="button" accessibilityLabel={label}>
        {body}
      </Pressable>
    );
  }
  return <View style={style}>{body}</View>;
}

/** REFEREE / CHIEF JUDGE signature boxes — the logged-in official signs digitally */
export function SheetSignatures({ referee, roles = ['REFEREE', 'CHIEF JUDGE'] }: { referee: string; roles?: string[] }) {
  return (
    <View style={s.sigs}>
      {roles.map((r, i) => (
        <View key={r} style={s.sigBox}>
          <Text style={s.sigTitle}>{r}</Text>
          <Text style={s.sigLine}>
            <Text style={s.metaKey}>NAME: </Text>
            {i === 0 ? referee : ''}
          </Text>
          <Text style={s.sigLine}>
            <Text style={s.metaKey}>SIGNATURE: </Text>
            {i === 0 ? 'Recorded digitally (AURA Officials PIN login)' : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Sheet legend line (e.g. "O cleared · – pass · X failure") */
export function SheetNote({ children }: { children: React.ReactNode }) {
  return <Text style={s.note}>{children}</Text>;
}

/** Positions written the way the paper result card spells them */
export const POSITION_WORD = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH', 'ELEVENTH', 'TWELFTH'];

const s = StyleSheet.create({
  titleWrap: { gap: 6 },
  federation: { textAlign: 'center', fontSize: 15, fontWeight: '900', color: INK, letterSpacing: 1 },
  metaBlock: { gap: 1 },
  meta: { fontSize: 12, color: INK },
  metaKey: { fontWeight: '800', color: INK },
  banner: { borderWidth: 2, borderStyle: 'dashed', borderColor: INK, paddingVertical: 6, alignItems: 'center', backgroundColor: '#fff' },
  bannerText: { fontSize: 17, fontWeight: '900', color: INK, letterSpacing: 0.5 },
  info: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderLeftWidth: 1, borderColor: RULE, backgroundColor: '#fff' },
  infoBox: { flexBasis: 130, flexShrink: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: RULE, paddingHorizontal: 8, paddingVertical: 5, minHeight: 44 },
  infoLabel: { fontSize: 10, fontWeight: '800', color: colors.muted },
  infoValue: { fontSize: 14, fontWeight: '800', color: INK },
  stageOn: { color: INK, fontWeight: '900', textDecorationLine: 'underline' },
  stageOff: { color: '#9ca3af', fontWeight: '600' },
  grid: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: RULE, backgroundColor: '#fff' },
  row: { flexDirection: 'row' },
  head: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: RULE, paddingHorizontal: 3, paddingVertical: 4, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f9fafb' },
  headText: { fontSize: 10.5, fontWeight: '900', color: INK, textAlign: 'center' },
  headSub: { fontSize: 9, fontWeight: '700', color: colors.muted, textAlign: 'center' },
  cell: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: RULE, minHeight: 40, paddingHorizontal: 4, justifyContent: 'center' },
  cellSel: { borderWidth: 3, borderColor: colors.blue, backgroundColor: colors.blueSoft },
  cellText: { fontSize: 14, fontWeight: '700', color: INK, textAlign: 'center' },
  sigs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sigBox: { flexGrow: 1, flexBasis: 240, borderWidth: 1.5, borderStyle: 'dashed', borderColor: INK, padding: 8, gap: 4, backgroundColor: '#fff' },
  sigTitle: { fontSize: 12, fontWeight: '900', color: INK, textAlign: 'center' },
  sigLine: { fontSize: 12, color: INK },
  note: { fontSize: 12, color: colors.muted },
});
