import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { font } from '@/theme/tokens';
import { T } from './T';

/** The Kitsune fox mask, on a 100×100 grid (the mark spans x 12–88, y 6–92). */
export const FOX = {
  head: 'M12,6 L40,30 L60,30 L88,6 L86,48 L66,72 L50,92 L34,72 L14,48 Z',
  eyes: 'M27,48 L44,54 L41,59 L30,55 Z M73,48 L56,54 L59,59 L70,55 Z',
  nose: 'M45,80 L55,80 L50,86 Z',
  ears: 'M19,16 L35,30 L23,40 Z M81,16 L65,30 L77,40 Z',
};

export function Fox({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="8 2 84 94">
      <Defs>
        <LinearGradient id="fox" x1="0" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor="#FFB347" />
          <Stop offset="0.55" stopColor="#FF5E7E" />
          <Stop offset="1" stopColor="#B45CFF" />
        </LinearGradient>
      </Defs>
      <Path d={`${FOX.head} ${FOX.eyes} ${FOX.nose}`} fill="url(#fox)" fillRule="evenodd" />
      <Path d={FOX.ears} fill="#fff" fillOpacity={0.32} />
    </Svg>
  );
}

export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.32 }}>
      <Fox size={size * 1.15} />
      <T style={{ fontFamily: font.display, fontWeight: '700', fontSize: size * 0.82, lineHeight: size * 1.05, letterSpacing: -0.4 }}>kitsune</T>
    </View>
  );
}
