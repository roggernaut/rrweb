import type Player from 'rrweb-player';

export type CaptureBackend = 'ffmpeg' | 'playwright';

export type RRwebPlayerProps = Omit<
  ConstructorParameters<typeof Player>[0]['props'],
  'events'
>;

export type RRvideoConfig = {
  input: string;
  output?: string;
  headless?: boolean;
  /**
   * A number typically between 0 and 1 for the Playwright backend.
   * The ffmpeg backend also accepts values greater than 1 to upscale.
   */
  resolutionRatio?: number;
  /**
   * How to capture frames.
   *
   * - `ffmpeg`: play the replayer on a virtual clock that advances one frame
   *   interval per captured frame, pipe JPEGs to ffmpeg. Use this for high
   *   fps / high resolution / MP4.
   * - `playwright`: Playwright `recordVideo` (CDP screencast). Caps around
   *   25fps and writes WebM. Kept for compatibility.
   */
  capture?: CaptureBackend;
  /** Output frames per second. Only used by the ffmpeg backend. Default: 60. */
  fps?: number;
  /** JPEG screenshot quality 0-100. Only used by the ffmpeg backend. Default: 90. */
  quality?: number;
  /** libx264 CRF. Only used by the ffmpeg backend. Default: 18. */
  crf?: number;
  /** libx264 preset. Only used by the ffmpeg backend. Default: veryfast. */
  x264Preset?: string;
  /**
   * Device pixel ratio used when screenshotting. 2 captures at 2× resolution.
   * Only used by the ffmpeg backend. Default: 1.
   */
  pixelRatio?: number;
  /**
   * Drive Chrome's compositor with `HeadlessExperimental.beginFrame`, so CSS
   * animations follow the virtual clock too. Needs headless Chromium on Linux.
   * `auto` enables it there and falls back to screenshots elsewhere.
   * Only used by the ffmpeg backend. Default: `auto`.
   */
  beginFrame?: boolean | 'auto';
  /** ffmpeg binary. Default: ffmpeg on PATH. */
  ffmpegPath?: string;
  onProgressUpdate?: (percent: number) => void;
  rrwebPlayer?: RRwebPlayerProps;
};

export type ResolvedRRvideoConfig = Required<
  Pick<
    RRvideoConfig,
    | 'input'
    | 'output'
    | 'headless'
    | 'resolutionRatio'
    | 'capture'
    | 'fps'
    | 'quality'
    | 'crf'
    | 'x264Preset'
    | 'pixelRatio'
    | 'beginFrame'
    | 'ffmpegPath'
    | 'onProgressUpdate'
    | 'rrwebPlayer'
  >
>;

export type ViewportSize = {
  width: number;
  height: number;
};
