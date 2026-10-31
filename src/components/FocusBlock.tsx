import type { ReactNode } from 'react';
import { type StyleProp, TVFocusGuideView, type ViewStyle } from 'react-native';
import { isTV } from '@/lib/tv';

/**
 * On a TV, keeps the remote's focus out of everything inside unless `enabled`. Used around web
 * pages: a WebView is focusable from the inside (its `focusable` prop only reaches its wrapper),
 * and once focus is in a page the D-pad scrolls the page instead of moving through the app.
 * Phones render the children as they are.
 */
export function FocusBlock({ enabled, style, children }: { enabled: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  if (!isTV) return <>{children}</>;
  return (
    <TVFocusGuideView focusable={enabled} style={style}>
      {children}
    </TVFocusGuideView>
  );
}
