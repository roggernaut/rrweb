export type PlayerFeatures = {
  jump?: false | { seconds?: number; keyboard?: 'page' | 'player' | 'off' };
  clickToPlay?: boolean;
  fullscreen?: boolean;
  timeline?: false | { maxIdleShare?: number };
};

export type PlayerControls = Partial<
  Record<
    'jump' | 'play' | 'time' | 'speed' | 'settings' | 'fullscreen',
    boolean
  >
>;
export type PlayerIconName =
  | 'jump-back'
  | 'jump-forward'
  | 'play'
  | 'pause'
  | 'speed'
  | 'settings'
  | 'enter-fullscreen'
  | 'exit-fullscreen';
export type PlayerIconContext = {
  name: PlayerIconName;
  seconds: number;
  document: Document;
};
export type PlayerIcons = Partial<
  Record<PlayerIconName, (context: PlayerIconContext) => SVGElement>
>;
export type JumpEvent = {
  fromMs: number;
  toMs: number;
  source: 'button' | 'keyboard' | 'api';
};

export function jumpSeconds(jump: PlayerFeatures['jump']) {
  const value = jump && jump.seconds;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 10;
}

/** Merge each feature independently. Arrays replace the previous selection. */
export function mergeFeatures(
  current: PlayerFeatures,
  patch: PlayerFeatures,
): PlayerFeatures {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const previous = current[key as keyof PlayerFeatures];
    Object.assign(next, {
      [key]:
        typeof previous === 'object' && typeof value === 'object'
          ? { ...previous, ...value }
          : value,
    });
  }
  return next;
}
