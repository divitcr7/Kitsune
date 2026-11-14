import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, TVFocusGuideView, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInRight, SlideOutRight } from 'react-native-reanimated';
import { haptics } from '@/lib/haptics';
import { isTV, tv } from '@/lib/tv';
import { color, radius } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { T } from './T';

export type SettingKey = 'quality' | 'audioLang' | 'version' | 'captions' | 'captionSize' | 'captionBg' | 'speed';
export type SettingOption = { id: string; label: string; note?: string };
export type SettingRow = { key: SettingKey; icon: IconName; label: string; value: string; options: SettingOption[]; selected: string };

/**
 * The player's settings: a list of rows (quality, audio language, sub or dub, captions, caption
 * size, speed); a row opens its options. A side sheet on phones, a remote-friendly panel on TV.
 * Back closes the options first, then the panel.
 */
export function PlayerSettings({ rows, onPick, onClose }: { rows: SettingRow[]; onPick: (key: SettingKey, id: string) => void; onClose: () => void }) {
  const [open, setOpen] = useState<SettingKey | null>(null);
  const row = open ? rows.find((r) => r.key === open) : undefined;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (open) setOpen(null);
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const body = row ? (
    <>
      <Pressable accessibilityRole="button" onPress={() => setOpen(null)} style={({ focused, pressed }) => [styles.head, pressed && styles.pressed, focused && styles.focused]}>
        <Icon name="chevron-left" size={isTV ? tv(26) : 24} tint={color.text} />
        <T variant="heading">{row.label}</T>
      </Pressable>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
        {row.options.map((o, i) => {
          const on = o.id === row.selected;
          return (
            <Pressable
              key={o.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              hasTVPreferredFocus={on || (i === 0 && !row.options.some((x) => x.id === row.selected))}
              onPress={() => {
                haptics.selection();
                onPick(row.key, o.id);
                setOpen(null);
              }}
              style={({ focused, pressed }) => [styles.row, pressed && styles.pressed, focused && styles.focused]}
            >
              <View style={styles.check}>{on ? <Icon name="check" size={isTV ? tv(22) : 20} tint={color.accent} /> : null}</View>
              <T style={styles.grow} numberOfLines={1}>
                {o.label}
              </T>
              {o.note ? (
                <T variant="caption" faint>
                  {o.note}
                </T>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  ) : (
    <>
      <View style={styles.head}>
        <T variant="heading">Settings</T>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
        {rows.map((r, i) => (
          <Pressable
            key={r.key}
            accessibilityRole="button"
            hasTVPreferredFocus={i === 0}
            onPress={() => {
              haptics.selection();
              setOpen(r.key);
            }}
            style={({ focused, pressed }) => [styles.row, pressed && styles.pressed, focused && styles.focused]}
          >
            <Icon name={r.icon} size={isTV ? tv(24) : 22} tint={color.text} />
            <T style={styles.grow} numberOfLines={1}>
              {r.label}
            </T>
            <T dim numberOfLines={1} style={styles.value}>
              {r.value}
            </T>
            <Icon name="chevron-right" size={isTV ? tv(22) : 20} tint={color.textDim} />
          </Pressable>
        ))}
      </ScrollView>
    </>
  );

  if (isTV) {
    return (
      <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(140)} style={styles.tvWrap}>
        <TVFocusGuideView key={open ?? 'rows'} autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.panel}>
          {body}
        </TVFocusGuideView>
      </Animated.View>
    );
  }
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable accessibilityLabel="Close settings" style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />
      <Animated.View entering={SlideInRight.duration(200)} exiting={SlideOutRight.duration(160)} style={styles.sheet}>
        {body}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', top: 12, bottom: 12, right: 12, width: 340, maxWidth: '60%', borderRadius: radius.lg, backgroundColor: 'rgba(22,22,26,0.97)', overflow: 'hidden' },
  tvWrap: { position: 'absolute', top: 0, bottom: 0, right: tv(48), justifyContent: 'center' },
  panel: { width: tv(460), maxHeight: '86%', borderRadius: tv(18), backgroundColor: 'rgba(22,22,26,0.97)', overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: isTV ? tv(22) : 18, paddingVertical: isTV ? tv(16) : 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  scroll: { flexGrow: 0 },
  list: { paddingVertical: isTV ? tv(8) : 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: isTV ? tv(14) : 12, minHeight: isTV ? tv(54) : 50, paddingHorizontal: isTV ? tv(22) : 18 },
  grow: { flex: 1 },
  value: { maxWidth: isTV ? tv(170) : 130, textAlign: 'right' },
  check: { width: isTV ? tv(24) : 22, alignItems: 'center' },
  pressed: { opacity: 0.6 },
  focused: { backgroundColor: 'rgba(255,255,255,0.12)' },
});
