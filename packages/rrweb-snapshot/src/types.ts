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

export type PrivacyPreset = 'strict' | 'balanced' | 'custom' | 'legacy';

export type PrivacyAction = 'allow' | 'mask' | 'exclude';

/**
 * `blur`, `pixelate`, and `shuffle` are portable policy vocabulary reserved
 * for visual recorders. DOM text is currently rendered with `replacement`.
 */
export type PrivacyMaskStyle =
  | 'replacement'
  | 'solid'
  | 'blur'
  | 'pixelate'
  | 'shuffle';

export type SensitiveDataKind =
  | 'credential'
  | 'payment'
  | 'identity'
  | 'contact'
  | 'location'
  | 'custom';

export type PrivacyRule = {
  target: PrivacyTarget;
  action: PrivacyAction;
  style?: PrivacyMaskStyle;
  classification?: SensitiveDataKind;
};

export type PrivacyTarget = {
  type: 'selector';
  /** A CSS selector. Rules also apply to descendants of the matched node. */
  selector: string;
  /**
   * Restrict an element rule to these attributes. Without this field, a rule
   * applies to element text, form values, and the standard sensitive
   * attributes.
   */
  attributes?: string[];
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
  custom: Array<{
    name: string;
    pattern: string;
    flags?: string;
    classification?: SensitiveDataKind;
    /** Skip this detector for shorter values. Defaults to 1. */
    minimumLength?: number;
    /**
     * Maximum possible match length. Used as overlap when scanning long values
     * in bounded chunks. Defaults to 256 and cannot exceed 1,024. Must be at
     * least `minimumLength`.
     */
    maximumMatchLength?: number;
  }>;
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

/** @internal Runtime form shared by snapshot and incremental observers. */
export type CompiledPrivacyPolicy = {
  policy: PrivacyPolicy;
  rules: Array<
    Omit<PrivacyRule, 'target'> & {
      selector: string;
      attributes?: Set<string>;
    }
  >;
  detectors: Array<{
    name: string;
    regex: RegExp;
    classification: SensitiveDataKind;
    minimumLength: number;
    maximumMatchLength: number;
    scanChunkSize: number;
    validate?: (candidate: string) => boolean;
  }>;
  minimumDetectorLength: number;
  blockSelector: string | null;
};

export type KeepIframeSrcFn = (src: string) => boolean;

export type BuildCache = {
  stylesWithHoverClass: Map<string, string>;
};
