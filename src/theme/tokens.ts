/**
 * Cinematic dark theme: true black canvas, quiet greys, white primary actions,
 * and Kitsune coral used sparingly (progress, the active tab, small highlights).
 */
export const color = {
  bg: '#000000',
  container1: '#0E0E11',
  container2: '#16161A',
  container3: '#1F1F24',
  container4: '#2A2A31',
  line: 'rgba(255,255,255,0.08)',
  text: '#FFFFFF',
  textDim: '#A7A7B1',
  textFaint: '#6D6D77',

  accent: '#FF6B3D',
  accentSoft: 'rgba(255,107,61,0.16)',
  onAccent: '#FFFFFF',

  /** Primary action: white with black label, like Apple TV / Max. */
  primary: '#FFFFFF',
  onPrimary: '#000000',
  ghost: 'rgba(255,255,255,0.14)',
  scrim: 'rgba(0,0,0,0.45)',
  danger: '#FF5A5F',
  dangerSoft: 'rgba(255,90,95,0.14)',
  star: '#FFC94D',
} as const;

export const font = {
  body: 'Inter',
  /** Wordmark only. */
  display: 'Unbounded',
} as const;

export const radius = { xs: 4, sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

/** Critically damped springs: motion settles cleanly, never wobbles. */
export const spring = {
  snappy: { damping: 26, stiffness: 380, mass: 0.6 },
  smooth: { damping: 30, stiffness: 220, mass: 0.9 },
  bouncy: { damping: 22, stiffness: 300, mass: 0.7 },
} as const;

export const TAB_BAR_HEIGHT = 64;
