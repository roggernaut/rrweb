import type { serializedNodeWithId } from '@rrweb/types';

export type tagMap = {
  [key: string]: string;
};

export type DialogAttributes = {
  open: string;
  /**
   * Represents the dialog's open mode.
   * `modal` means the dialog is opened with `showModal()`.
   * `non-modal` means the dialog is opened with `show()` or
   * by adding an `open` attribute.
   */
  rr_open_mode: 'modal' | 'non-modal';
  /**
   * Currently unimplemented, but in future can be used to:
   * Represents the order of which of the dialog was opened.
   * This is useful for replaying the dialog `.showModal()` in the correct order.
   */
  // rr_open_mode_index?: number;
};

export interface ICanvas extends HTMLCanvasElement {
  __context: string;
}

export type idNodeMap = Map<number, Node>;

export type nodeMetaMap = WeakMap<Node, serializedNodeWithId>;

export type MaskInputOptions = Partial<{
  color: boolean;
  date: boolean;
  'datetime-local': boolean;
  email: boolean;
  month: boolean;
  number: boolean;
  range: boolean;
  search: boolean;
  tel: boolean;
  text: boolean;
  time: boolean;
  url: boolean;
  week: boolean;
  // unify textarea and select element with text input
  textarea: boolean;
  select: boolean;
  password: boolean;
}>;

export type SlimDOMOptions = Partial<{
  script: boolean;
  comment: boolean;
  headFavicon: boolean;
  headWhitespace: boolean;
  headMetaDescKeywords: boolean;
  headMetaSocial: boolean;
  headMetaRobots: boolean;
  headMetaHttpEquiv: boolean;
  headMetaAuthorship: boolean;
  headMetaVerification: boolean;
  /**
   * blocks title tag 'animations' which can generate a lot of mutations that aren't usually displayed in replayers
   **/
  headTitleMutations: boolean;
}>;

export type MaskTextFn = (text: string, element: HTMLElement | null) => string;
export type MaskInputFn = (text: string, element: HTMLElement) => string;
export type MaskAttributeFn = (
  name: string,
  value: string,
  element: Element,
) => string;

/** A versioned, portable Privacy at Capture policy understood by rrweb. */
export type PrivacyPolicy = {
  version: 1;
  preset: PrivacyPreset;
  rules?: PrivacyRule[];
  detectors?: PrivacyDetectorOptions;
  url?: PrivacyUrlOptions;
};

export type PrivacyPreset = 'strict' | 'balanced' | 'legacy';

/** `unmask` is an alias of `allow`. */
export type PrivacyAction = 'allow' | 'unmask' | 'mask' | 'exclude';

export type PrivacyRule = {
  target: PrivacyTarget;
  action: PrivacyAction;
};

export type PrivacyTarget = {
  type: 'selector';
  /** A CSS selector. Rules also apply to descendants of the matched node. */
  selector: string;
};

export type PrivacyDetectorOptions = Partial<{
  /**
   * Explicit opt-in flags for built-in heuristic detectors. Presets do not
   * enable these; use `@rrweb/rrweb-plugin-privacy-detectors` or
   * `applyPrivacyDetectors`.
   */
  email: boolean;
  phone: boolean;
  paymentCard: boolean;
  ssn: boolean;
  ipAddress: boolean;
}>;

export type PrivacyUrlOptions = {
  /** Query parameter names whose values are always removed. */
  blockedQueryParameters?: string[];
  /**
   * When supplied, all query parameter values except these are removed.
   * Parameter names remain visible so replays retain useful routing context.
   */
  allowedQueryParameters?: string[];
  removeHash?: boolean;
};

export type CompiledDetector = {
  name: string;
  test: (value: string) => boolean;
};

/** @internal Runtime form shared by snapshot and incremental observers. */
export type CompiledPrivacyPolicy = {
  policy: PrivacyPolicy;
  preset: PrivacyPreset;
  /** 'mask' rules + [data-privacy="mask"] + vendor classes (+ '*' under strict) */
  maskTextSelector: string | null;
  /** 'allow'/'unmask' rules + [data-privacy="allow"] + vendor unmask classes */
  unmaskTextSelector: string | null;
  /** 'exclude' rules + [data-privacy="exclude"] + vendor block classes */
  blockSelector: string | null;
  /**
   * true under balanced/strict, and whenever any heuristic detector is
   * active: detectors scan text content only, so input values are occluded
   * to length rather than scanned as they are typed.
   */
  maskAllInputs: boolean;
  /** ['title','placeholder','aria-label'] under balanced/strict, else [] */
  maskedAttributes: string[];
  /** true under strict */
  blockMedia: boolean;
  /** true under balanced/strict */
  sanitizeUrls: boolean;
  /** precomputed, lowercased */
  blockedQueryParameters: Set<string>;
  allowedQueryParameters: Set<string> | null;
  removeHash: boolean;
  /** populated by applyPrivacyDetectors; [] otherwise. Text content only. */
  detectors: CompiledDetector[];
};

export type KeepIframeSrcFn = (src: string) => boolean;

export type BuildCache = {
  stylesWithHoverClass: Map<string, string>;
};
