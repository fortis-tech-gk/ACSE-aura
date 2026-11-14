/**
 * AURA design system — navy & gold, matching the Dr. ACS AURA 2026 ID card.
 *
 *  - Navy header band (with the status bar area) + cream page + white cards with a soft shadow
 *  - Gold for highlights, brand lines and the main call to action
 *  - Cinzel (the ID card's display face) for titles; the system font for everything else
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './Icon';

export { Icon, type IconName } from './Icon';

/** The current time, refreshed every `everyMs` — keeps "x min ago" labels pure during render */
export function useNow(everyMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export const colors = {
  navy: '#0f1e3d',
  navy2: '#1b2f5c',
  navySoft: '#e9edf6',
  /** Links, selected states and secondary accents (a navy-blue that reads well on cream) */
  blue: '#1f3f86',
  blueSoft: '#e7ecf7',
  gold: '#c9a24a',
  goldBright: '#e9c768',
  goldDeep: '#9a7426',
  goldSoft: '#f7eed6',
  bg: '#f6f3ec',
  card: '#ffffff',
  text: '#141b2d',
  muted: '#6b7280',
  border: '#e8e1d1',
  green: '#0f7a4f',
  greenSoft: '#dcf3e7',
  amber: '#a35a07',
  amberSoft: '#fdf0d5',
  red: '#c62828',
  redSoft: '#fde4e1',
  /** Text on the navy band */
  onNavy: '#ffffff',
  onNavyMuted: '#b9c3da',
};

export const fonts = {
  /** Cinzel — loaded in the root layout; falls back to a serif until it is ready */
  display: 'Cinzel_900Black',
  displayBold: 'Cinzel_700Bold',
};

export const shadow: ViewStyle = Platform.select({
  web: { boxShadow: '0 6px 18px rgba(15, 30, 61, 0.08)' } as ViewStyle,
  default: { shadowColor: '#0f1e3d', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
}) as ViewStyle;

// ---------------------------------------------------------------------------------------------
// Page frame
// ---------------------------------------------------------------------------------------------

/**
 * A screen: optional navy header band (drawn under the status bar), then the scrolling page.
 * Without `header`, the page simply starts below the status bar.
 */
export function Screen({
  children,
  header,
  refreshing,
  onRefresh,
  scroll = true,
  edges = ['top'],
  maxWidth,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  edges?: ('top' | 'bottom')[];
  /** Keep content readable on tablets: centred column at most this wide */
  maxWidth?: number;
}) {
  const insets = useSafeAreaInsets();
  const limit = maxWidth ? { width: '100%' as const, maxWidth, alignSelf: 'center' as const } : null;
  const top = header ? 0 : edges.includes('top') ? insets.top : 0;
  const bottom = edges.includes('bottom') ? insets.bottom : 0;
  const content = [styles.scroll, { paddingBottom: 32 + bottom }, limit];
  return (
    <View style={[styles.safe, { paddingTop: top }]}>
      {header}
      {scroll ? (
        <ScrollView
          contentContainerStyle={content}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.gold} colors={[colors.navy]} /> : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[content, { flex: 1 }]}>{children}</View>
      )}
    </View>
  );
}

/**
 * Navy header band: small gold eyebrow, Cinzel title, optional subtitle, back button and right slot.
 * A thin gold line closes it, like the ID card footer.
 */
export function AppHeader({
  eyebrow,
  title,
  subtitle,
  right,
  back,
  children,
  maxWidth,
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** Show a back arrow: pass a label ("More") or true */
  back?: string | boolean;
  children?: React.ReactNode;
  maxWidth?: number;
}) {
  const insets = useSafeAreaInsets();
  const limit = maxWidth ? { width: '100%' as const, maxWidth, alignSelf: 'center' as const } : null;
  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <View style={[{ gap: 4 }, limit]}>
        {back ? (
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            accessibilityRole="button"
            accessibilityLabel={typeof back === 'string' ? `Back to ${back}` : 'Back'}
            hitSlop={12}
            style={styles.back}
          >
            <Icon name="back" size={18} color={colors.goldBright} />
            <Text style={styles.backText}>{typeof back === 'string' ? back : 'Back'}</Text>
          </Pressable>
        ) : null}
        <View style={styles.headerRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
            {!!title && (
              <Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={2}>
                {title}
              </Text>
            )}
            {!!subtitle && <Text style={styles.headerSub}>{subtitle}</Text>}
          </View>
          {right}
        </View>
        {children}
      </View>
      <View style={styles.headerRule} />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** In-page heading in the display face */
export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[styles.title, style]} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Small gold-ruled section label: "── TODAY'S MEALS" */
export function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionBar} />
      <Text style={styles.sectionText}>{children}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

type Tone = 'blue' | 'green' | 'amber' | 'red' | 'grey' | 'gold' | 'navy';
const toneMap: Record<Tone, { bg: string; fg: string }> = {
  blue: { bg: colors.blueSoft, fg: colors.blue },
  green: { bg: colors.greenSoft, fg: colors.green },
  amber: { bg: colors.amberSoft, fg: colors.amber },
  red: { bg: colors.redSoft, fg: colors.red },
  grey: { bg: '#efece4', fg: '#5b6170' },
  gold: { bg: colors.goldSoft, fg: colors.goldDeep },
  navy: { bg: colors.navy, fg: colors.goldBright },
};

export function Pill({ label, tone = 'grey', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = toneMap[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      {icon ? <Icon name={icon} size={13} color={t.fg} /> : null}
      <Text style={[styles.pillText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  iconRight,
  style,
}: {
  title: string;
  onPress: () => void;
  /** primary = navy · gold = main call to action · secondary = outlined · danger · ghost = text only */
  variant?: 'primary' | 'gold' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  /** Icon after the label (e.g. a forward chevron) */
  iconRight?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const v = {
    primary: { bg: colors.navy, fg: '#fff', border: colors.navy },
    gold: { bg: colors.gold, fg: colors.navy, border: colors.goldDeep },
    secondary: { bg: colors.card, fg: colors.navy, border: colors.border },
    danger: { bg: colors.redSoft, fg: colors.red, border: colors.redSoft },
    ghost: { bg: 'transparent', fg: colors.blue, border: 'transparent' },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border, opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1 },
        variant === 'gold' && styles.buttonGold,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Icon name={icon} size={18} color={v.fg} /> : null}
          <Text style={[styles.buttonText, { color: v.fg }]}>{title}</Text>
          {iconRight ? <Icon name={iconRight} size={20} color={v.fg} /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** Tappable list row: icon tile, title + subtitle, chevron */
export function ListRow({
  icon,
  title,
  subtitle,
  onPress,
  right,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: '#faf7f0' }]}>
      <View style={styles.listIcon}>
        <Icon name={icon} size={20} color={colors.navy} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.listTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.listSub}>{subtitle}</Text>}
      </View>
      {right ?? (onPress ? <Icon name="chevron" size={18} color={colors.muted} /> : null)}
    </Pressable>
  );
}

/** Value + label tile (counters, ranks) */
export function Stat({ label, value, tone = 'light' }: { label: string; value: string; tone?: 'light' | 'navy' }) {
  const dark = tone === 'navy';
  return (
    <View style={[styles.stat, dark && styles.statDark]}>
      <Text style={[styles.statValue, dark && { color: colors.goldBright }]}>{value}</Text>
      <Text style={[styles.statLabel, dark && { color: colors.onNavyMuted }]}>{label}</Text>
    </View>
  );
}

/** Segmented control (tabs inside a page) */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <Pressable key={o.key} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => onChange(o.key)} style={[styles.segBtn, active && styles.segActive]}>
            <Text style={[styles.segText, active && styles.segTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type SelectOption<T extends string> = { value: T; label: string; sub?: string; icon?: IconName };

/** Dropdown field: shows the chosen option; tapping opens a sheet with the choices */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
}: {
  label: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${cur ? cur.label : placeholder}. Tap to change.`}
        style={({ pressed }) => [styles.field, styles.selectField, pressed && { borderColor: colors.gold }]}
      >
        {cur?.icon ? <Icon name={cur.icon} size={20} color={colors.navy} /> : null}
        <Text style={[styles.selectText, !cur && { color: '#9aa1ae', fontWeight: '600' }]} numberOfLines={1}>
          {cur ? cur.label : placeholder}
        </Text>
        <Icon name="chevronDown" size={18} color={colors.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setOpen(false)} accessibilityLabel="Close">
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{label}</Text>
            {options.map((o) => {
              const active = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && { opacity: 0.8 }]}
                >
                  {o.icon ? (
                    <View style={[styles.listIcon, active && { backgroundColor: colors.navy }]}>
                      <Icon name={o.icon} size={20} color={active ? colors.goldBright : colors.navy} />
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionTitle}>{o.label}</Text>
                    {!!o.sub && <Text style={styles.listSub}>{o.sub}</Text>}
                  </View>
                  {active ? <Icon name="check" size={20} color={colors.gold} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export function OfflineBanner({
  offline,
  lastSyncedAt,
  note = 'Reminders still work.',
}: {
  offline: boolean;
  lastSyncedAt: number | null;
  note?: string;
}) {
  const now = useNow();
  if (!offline) return null;
  const mins = lastSyncedAt ? Math.max(0, Math.round((now - lastSyncedAt) / 60000)) : null;
  return (
    <View style={styles.offline} accessibilityRole="alert">
      <Icon name="offline" size={18} color={colors.amber} />
      <Text style={styles.offlineText}>
        Offline — showing saved info{mins !== null ? ` from ${mins < 1 ? 'just now' : `${mins} min ago`}` : ''}. {note}
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 32, gap: 14 },
  header: { backgroundColor: colors.navy, paddingHorizontal: 18, paddingBottom: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerRule: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: colors.gold },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2, marginBottom: 2 },
  backText: { color: colors.goldBright, fontWeight: '700', fontSize: 14 },
  eyebrow: { color: colors.goldBright, fontSize: 11, fontWeight: '800', letterSpacing: 2.2, textTransform: 'uppercase' },
  headerTitle: { color: colors.onNavy, fontFamily: fonts.display, fontSize: 25, lineHeight: 31, marginTop: 2 },
  headerSub: { color: colors.onNavyMuted, fontSize: 13.5, marginTop: 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  title: { fontFamily: fonts.display, fontSize: 21, color: colors.navy },
  section: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  sectionBar: { width: 18, height: 2, backgroundColor: colors.gold, borderRadius: 1 },
  sectionText: { fontSize: 12, fontWeight: '900', color: colors.goldDeep, letterSpacing: 1.6, textTransform: 'uppercase' },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '800' },
  button: { minHeight: 52, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  buttonGold: { borderBottomWidth: 3 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  listIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' },
  listTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  listSub: { fontSize: 13, color: colors.muted, marginTop: 1 },
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', ...shadow },
  statDark: { backgroundColor: 'rgba(255,255,255,0.07)', borderColor: 'rgba(233,199,104,0.35)', elevation: 0, shadowOpacity: 0 },
  statValue: { fontSize: 22, fontWeight: '900', color: colors.navy },
  statLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 },
  segment: { flexDirection: 'row', backgroundColor: '#ebe5d6', borderRadius: 14, padding: 4, gap: 4 },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  segActive: { backgroundColor: colors.navy },
  segText: { fontSize: 13, fontWeight: '800', color: '#6b6457' },
  segTextActive: { color: colors.goldBright },
  fieldLabel: { fontSize: 12, fontWeight: '900', color: colors.navy, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
  field: { minHeight: 54, borderWidth: 1.5, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, backgroundColor: '#fffdf8' },
  selectField: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selectText: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(10,18,38,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 30, gap: 6, width: '100%', maxWidth: 560, alignSelf: 'center' },
  sheetTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.navy, marginBottom: 6, textAlign: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: 'transparent' },
  optionActive: { borderColor: colors.gold, backgroundColor: '#fffaf0' },
  optionTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.amberSoft, borderRadius: 14, padding: 12 },
  offlineText: { flex: 1, color: colors.amber, fontSize: 13, fontWeight: '700', lineHeight: 18 },
});
