import * as Haptics from 'expo-haptics';
import { isTV } from './tv';

/** Haptics, silently skipped on a TV (no motor, and a remote in your hand). */
export const haptics = {
  selection: () => {
    if (!isTV) Haptics.selectionAsync().catch(() => {});
  },
  impact: (style = Haptics.ImpactFeedbackStyle.Medium) => {
    if (!isTV) Haptics.impactAsync(style).catch(() => {});
  },
  notify: (type: Haptics.NotificationFeedbackType) => {
    if (!isTV) Haptics.notificationAsync(type).catch(() => {});
  },
};

export const { NotificationFeedbackType } = Haptics;
