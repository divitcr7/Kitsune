import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';
import { color } from '@/theme/tokens';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Material icon (community set: has filled + outline pairs for active/inactive states). */
export function Icon({ name, size = 24, tint = color.text }: { name: IconName; size?: number; tint?: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={tint} />;
}

export const iconFont = MaterialCommunityIcons.font;
