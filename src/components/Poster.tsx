import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';
import type { Show } from '@/lib/api';
import { year } from '@/lib/format';
import { art } from '@/lib/img';
import { openShow } from '@/lib/nav';
import { color, font, radius } from '@/theme/tokens';
import { FocusRing, PressableScale } from './PressableScale';
import { T } from './T';

export function PosterArt({ show, width, rounded = radius.sm }: { show: Pick<Show, 'id' | 'poster'>; width: number; rounded?: number }) {
  const { source, placeholder } = art(show.poster, 'poster', width > 170 ? '640x960' : '480x720');
  return (
    <View style={[styles.art, { width, height: width * 1.5, borderRadius: rounded }]}>
      <Image
        source={source}
        placeholder={placeholder}
        placeholderContentFit="cover"
        contentFit="cover"
        transition={280}
        recyclingKey={show.id}
        cachePolicy="memory-disk"
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.rim, { borderRadius: rounded }]} />
      <FocusRing radius={rounded} />
    </View>
  );
}

/** Poster with an optional title underneath; `bare` drops the text for art-only shelves. */
export function PosterCard({ show, width = 124, subtitle, bare }: { show: Show; width?: number; subtitle?: string; bare?: boolean }) {
  const sub = subtitle ?? [show.type, year(show.release_date)].filter(Boolean).join(' · ');
  return (
    <PressableScale onPress={() => openShow(show)} style={{ width }} accessibilityLabel={show.name}>
      <PosterArt show={show} width={width} />
      {bare ? null : (
        <>
          <T variant="label" numberOfLines={1} style={styles.title}>
            {show.name}
          </T>
          {sub ? (
            <T variant="caption" faint numberOfLines={1} style={{ marginTop: 1 }}>
              {sub}
            </T>
          ) : null}
        </>
      )}
    </PressableScale>
  );
}

/** Top 10: a huge outlined numeral with the poster overlapping it. */
export function RankCard({ show, rank, width = 118 }: { show: Show; rank: number; width?: number }) {
  const h = width * 1.5;
  // The numeral's room scales with the poster (the phone shelf is drawn at 118).
  const numW = Math.round((rank >= 10 ? 112 : 70) * (width / 118));
  return (
    <PressableScale onPress={() => openShow(show)} style={{ width: numW + width - 22, height: h }} accessibilityLabel={`${rank}. ${show.name}`}>
      <Svg width={numW + 10} height={h} style={styles.rank}>
        <SvgText
          x={numW / 2 + 2}
          y={h - 2}
          textAnchor="middle"
          fontFamily={font.display}
          fontWeight="700"
          fontSize={h * 0.66}
          letterSpacing={-6}
          fill={color.bg}
          stroke="rgba(255,255,255,0.88)"
          strokeWidth={2}
        >
          {rank}
        </SvgText>
      </Svg>
      <View style={[styles.rankArt, { left: numW - 22 }]}>
        <PosterArt show={show} width={width} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  art: { backgroundColor: color.container2, overflow: 'hidden' },
  rim: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
  title: { marginTop: 9, fontSize: 13 },
  rank: { position: 'absolute', left: 0, top: 0 },
  rankArt: { position: 'absolute', top: 0 },
});
