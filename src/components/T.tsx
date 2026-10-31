import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import { TEXT_SCALE } from '@/lib/tv';
import { color, font } from '@/theme/tokens';

type Variant = 'hero' | 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'micro';

export type TProps = TextProps & { variant?: Variant; dim?: boolean; faint?: boolean; color?: string };

/** The one text component: Inter, tight and confident like a streaming app's UI. */
export function T({ variant = 'body', dim, faint, color: c, style, ...rest }: TProps) {
  return (
    <Text
      {...rest}
      style={[styles.base, styles[variant], dim && styles.dim, faint && styles.faint, c ? { color: c } : null, style]}
    />
  );
}

const variants: Record<Variant, TextStyle> = {
  hero: { fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  display: { fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: -0.7 },
  title: { fontSize: 19, lineHeight: 24, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 14, lineHeight: 21, fontWeight: '400', letterSpacing: -0.1 },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600', letterSpacing: -0.1 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0 },
  micro: { fontSize: 10.5, lineHeight: 14, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
};

/** Type set for a TV is the phone's, scaled up for the viewing distance. */
export const sized = (n: number) => Math.round(n * TEXT_SCALE * 2) / 2;

const styles = StyleSheet.create({
  base: { color: color.text, fontFamily: font.body, includeFontPadding: false },
  ...(Object.fromEntries(
    Object.entries(variants).map(([k, v]) => [k, { ...v, fontSize: sized(v.fontSize as number), lineHeight: sized(v.lineHeight as number) }]),
  ) as Record<Variant, TextStyle>),
  dim: { color: color.textDim },
  faint: { color: color.textFaint },
});
