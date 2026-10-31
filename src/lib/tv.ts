import { Dimensions, Platform } from 'react-native';

/** Android TV / Google TV (the same APK runs on phones, where this is false). */
export const isTV = Platform.isTV;

// TV layouts are drawn for a 960×540 dp canvas (what 1080p and 4K TVs report) and scaled for boxes
// that report a different density. A TV's window doesn't change size, so this is read once.
const scale = isTV ? Math.max(0.75, Dimensions.get('window').width / 960) : 1;

/** A TV layout size in dp. */
export const tv = (n: number) => Math.round(n * scale);

/** Text on a TV is read from across the room. */
export const TEXT_SCALE = isTV ? 1.15 * scale : 1;

/** Side margin of pages: overscan-safe on a TV (5%), the phone's usual 20 otherwise. */
export const EDGE = isTV ? tv(48) : 20;

/** Height of the TV's top navigation bar. */
export const TV_NAV = tv(56);

/**
 * Highlight for a full-width list row while it has the remote's focus: a tonal plate that bleeds
 * past the row's edges without moving its content.
 */
export const rowFocus = isTV ? { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: tv(10), marginHorizontal: -tv(12), paddingHorizontal: tv(12) } : {};
