import type { ICanvas, Mirror } from 'rrweb-snapshot';
import type {
  blockClass,
  canvasManagerMutationCallback,
  canvasMutationCallback,
  canvasMutationCommand,
  canvasMutationWithType,
  IWindow,
  listenerHandler,
  CanvasArg,
  CanvasMasking,
  DataURLOptions,
} from '@rrweb/types';
import { isBlocked } from '../../../utils';
import { CanvasContext } from '@rrweb/types';
import initCanvas2DMutationObserver from './2d';
import initCanvasContextObserver from './canvas';
import initCanvasWebGLMutationObserver from './webgl';
import ImageBitmapDataURLWorker from '../../workers/image-bitmap-data-url-worker?worker&inline';
import type { ImageBitmapDataURLRequestWorker } from '../../workers/image-bitmap-data-url-worker';
import {
  computeFrameMaskRegions,
  getCanvasContentBoxSize,
  isCanvasMaskingConfigured,
  SKIP_FRAME,
} from './canvas-mask';

export type RafStamps = { latestId: number; invokeId: number | null };

type pendingCanvasMutationsMap = Map<
  HTMLCanvasElement,
  canvasMutationWithType[]
>;

export class CanvasManager {
  private pendingCanvasMutations: pendingCanvasMutationsMap = new Map();
  private rafStamps: RafStamps = { latestId: 0, invokeId: null };
  private mirror: Mirror;

  private mutationCb: canvasMutationCallback;
  private resetObservers?: listenerHandler;
  private frozen = false;
  private locked = false;
  private resetFrameDedup?: () => void;

  /**
   * Shadow roots the shadow-DOM manager is actively observing. FPS canvas
   * discovery searches these directly instead of recursively re-walking
   * `querySelectorAll('*')` for shadow hosts on every animation frame -
   * nested shadow roots are tracked in turn as the shadow-DOM manager
   * starts observing them, so no recursion is needed here.
   */
  private trackedShadowRoots = new Set<ShadowRoot>();

  public reset() {
    this.pendingCanvasMutations.clear();
    this.resetObservers && this.resetObservers();
    this.resetFrameDedup = undefined;
  }

  /** Called by the shadow-DOM manager when it starts observing a shadow root. */
  public addShadowRoot(shadowRoot: ShadowRoot) {
    this.trackedShadowRoots.add(shadowRoot);
  }

  /** Called by the shadow-DOM manager when it stops observing a shadow root. */
  public removeShadowRoot(shadowRoot: ShadowRoot) {
    this.trackedShadowRoots.delete(shadowRoot);
  }

  /** Start a new canvas frame epoch after a DOM full snapshot. */
  public onFullSnapshot() {
    this.resetFrameDedup?.();
  }

  public freeze() {
    this.frozen = true;
  }

  public unfreeze() {
    this.frozen = false;
  }

  public lock() {
    this.locked = true;
  }

  public unlock() {
    this.locked = false;
  }

  constructor(options: {
    recordCanvas: boolean;
    mutationCb: canvasMutationCallback;
    win: IWindow;
    blockClass: blockClass;
    blockSelector: string | null;
    mirror: Mirror;
    sampling?: 'all' | number;
    dataURLOptions: DataURLOptions;
    canvasMasking?: CanvasMasking;
  }) {
    const {
      sampling = 'all',
      win,
      blockClass,
      blockSelector,
      recordCanvas,
      dataURLOptions,
      canvasMasking,
    } = options;
    this.mutationCb = options.mutationCb;
    this.mirror = options.mirror;

    if (recordCanvas && sampling === 'all')
      this.initCanvasMutationObserver(win, blockClass, blockSelector);
    if (recordCanvas && typeof sampling === 'number')
      this.initCanvasFPSObserver(sampling, win, blockClass, blockSelector, {
        dataURLOptions,
        canvasMasking,
      });
  }

  private processMutation: canvasManagerMutationCallback = (
    target,
    mutation,
  ) => {
    const newFrame =
      this.rafStamps.invokeId &&
      this.rafStamps.latestId !== this.rafStamps.invokeId;
    if (newFrame || !this.rafStamps.invokeId)
      this.rafStamps.invokeId = this.rafStamps.latestId;

    if (!this.pendingCanvasMutations.has(target)) {
      this.pendingCanvasMutations.set(target, []);
    }

    this.pendingCanvasMutations.get(target)!.push(mutation);
  };

  private initCanvasFPSObserver(
    fps: number,
    win: IWindow,
    blockClass: blockClass,
    blockSelector: string | null,
    options: {
      dataURLOptions: DataURLOptions;
      canvasMasking?: CanvasMasking;
    },
  ) {
    if (!('OffscreenCanvas' in win)) return;

    const canvasContextReset = initCanvasContextObserver(
      win,
      blockClass,
      blockSelector,
      true,
    );
    const snapshotInProgressMap: Map<number, boolean> = new Map();
    let rafId: number;
    let worker: ImageBitmapDataURLRequestWorker;
    try {
      worker =
        new ImageBitmapDataURLWorker() as ImageBitmapDataURLRequestWorker;
    } catch {
      canvasContextReset();
      return;
    }
    let workerErrored = false;
    worker.onerror = () => {
      workerErrored = true;
      cancelAnimationFrame(rafId);
      worker.terminate?.();
      this.resetFrameDedup = undefined;
    };
    this.resetFrameDedup = () => worker.postMessage({ resetFrameDedup: true });
    worker.onmessage = (e) => {
      const { id } = e.data;
      snapshotInProgressMap.set(id, false);

      if (!('base64' in e.data)) return;

      const { base64, type, width, height } = e.data;
      this.mutationCb({
        id,
        type: CanvasContext['2D'],
        commands: [
          {
            property: 'clearRect', // wipe canvas
            args: [0, 0, width, height],
          },
          {
            property: 'drawImage', // draws (semi-transparent) image
            args: [
              {
                rr_type: 'ImageBitmap',
                args: [
                  {
                    rr_type: 'Blob',
                    data: [{ rr_type: 'ArrayBuffer', base64 }],
                    type,
                  },
                ],
              } as CanvasArg,
              0,
              0,
            ],
          },
        ],
      });
    };

    const timeBetweenSnapshots = 1000 / fps;
    let lastSnapshotTime = 0;
    const getCanvas = (): HTMLCanvasElement[] => {
      const matchedCanvas: HTMLCanvasElement[] = [];
      const collect = (root: ParentNode) => {
        try {
          root.querySelectorAll('canvas').forEach((canvas) => {
            if (!isBlocked(canvas, blockClass, blockSelector, true)) {
              matchedCanvas.push(canvas);
            }
          });
        } catch {
          // A broken custom DOM implementation must not cancel future frames.
        }
      };
      collect(win.document);
      this.trackedShadowRoots.forEach((root) => collect(root));
      return matchedCanvas;
    };

    const takeCanvasSnapshots = (timestamp: DOMHighResTimeStamp) => {
      if (workerErrored) return;
      if (
        lastSnapshotTime &&
        timestamp - lastSnapshotTime < timeBetweenSnapshots
      ) {
        rafId = requestAnimationFrame(takeCanvasSnapshots);
        return;
      }
      lastSnapshotTime = timestamp;

      getCanvas()
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        .forEach(async (canvas: HTMLCanvasElement) => {
          const id = this.mirror.getId(canvas);
          if (snapshotInProgressMap.get(id)) return;

          // The browser throws if the canvas is 0 in size
          // Uncaught (in promise) DOMException: Failed to execute 'createImageBitmap' on 'Window': The source image width is 0.
          // Assuming the same happens with height
          if (canvas.width === 0 || canvas.height === 0) return;

          snapshotInProgressMap.set(id, true);
          try {
            if (['webgl', 'webgl2'].includes((canvas as ICanvas).__context)) {
              // if the canvas hasn't been modified recently,
              // its contents won't be in memory and `createImageBitmap`
              // will return a transparent imageBitmap

              const context = canvas.getContext(
                (canvas as ICanvas).__context,
              ) as WebGLRenderingContext | WebGL2RenderingContext | null;
              if (context?.isContextLost?.()) {
                snapshotInProgressMap.set(id, false);
                return;
              }
              if (
                context?.getContextAttributes()?.preserveDrawingBuffer === false
              ) {
                // Hack to load canvas back into memory so `createImageBitmap` can grab it's contents.
                // Context: https://twitter.com/Juice10/status/1499775271758704643
                // Preferably we set `preserveDrawingBuffer` to true, but that's not always possible,
                // especially when canvas is loaded before rrweb.
                // This hack can wipe the background color of the canvas in the (unlikely) event that
                // the canvas background was changed but clear was not called directly afterwards.
                // Example of this hack having negative side effect: https://visgl.github.io/react-map-gl/examples/layers
                context.clear(context.COLOR_BUFFER_BIT);
              }
            }
            let displayWidth = canvas.clientWidth || canvas.width;
            let displayHeight = canvas.clientHeight || canvas.height;
            // Gate on `isCanvasMaskingConfigured`, not truthiness: a
            // provider whose `isConfigured()` currently returns false masks
            // nothing, so `computeFrameMaskRegions` will ignore the measured
            // box anyway -- measuring (and failing closed on an unmeasurable
            // canvas) would cost a layout flush per frame for nothing.
            if (isCanvasMaskingConfigured(options.canvasMasking)) {
              // The backing store maps onto the content box, not the
              // border box that `clientWidth`/`clientHeight` report -
              // measure it precisely whenever masking is configured so
              // mask regions never get scaled against the wrong box. A
              // canvas whose content box can't be measured (or has zero
              // area) fails closed: skip the frame rather than fall back
              // to a potentially wrong scale.
              const contentBox = getCanvasContentBoxSize(canvas);
              if (!contentBox) {
                snapshotInProgressMap.set(id, false);
                return;
              }
              displayWidth = contentBox.width;
              displayHeight = contentBox.height;
            }
            const maskRegions = computeFrameMaskRegions(
              options.canvasMasking,
              canvas,
              canvas.width,
              canvas.height,
              displayWidth,
              displayHeight,
            );
            if (maskRegions === SKIP_FRAME) {
              snapshotInProgressMap.set(id, false);
              return;
            }
            const bitmap = await createImageBitmap(canvas);
            worker.postMessage(
              {
                id,
                bitmap,
                width: canvas.width,
                height: canvas.height,
                dataURLOptions: options.dataURLOptions,
                maskRegions,
              },
              [bitmap],
            );
          } catch {
            snapshotInProgressMap.set(id, false);
          }
        });
      rafId = requestAnimationFrame(takeCanvasSnapshots);
    };

    rafId = requestAnimationFrame(takeCanvasSnapshots);

    this.resetObservers = () => {
      canvasContextReset();
      cancelAnimationFrame(rafId);
      worker.terminate?.();
      this.resetFrameDedup = undefined;
    };
  }

  private initCanvasMutationObserver(
    win: IWindow,
    blockClass: blockClass,
    blockSelector: string | null,
  ): void {
    this.startRAFTimestamping();
    this.startPendingCanvasMutationFlusher();

    const canvasContextReset = initCanvasContextObserver(
      win,
      blockClass,
      blockSelector,
      false,
    );
    const canvas2DReset = initCanvas2DMutationObserver(
      this.processMutation.bind(this),
      win,
      blockClass,
      blockSelector,
    );

    const canvasWebGL1and2Reset = initCanvasWebGLMutationObserver(
      this.processMutation.bind(this),
      win,
      blockClass,
      blockSelector,
    );

    this.resetObservers = () => {
      canvasContextReset();
      canvas2DReset();
      canvasWebGL1and2Reset();
    };
  }

  private startPendingCanvasMutationFlusher() {
    requestAnimationFrame(() => this.flushPendingCanvasMutations());
  }

  private startRAFTimestamping() {
    const setLatestRAFTimestamp = (timestamp: DOMHighResTimeStamp) => {
      this.rafStamps.latestId = timestamp;
      requestAnimationFrame(setLatestRAFTimestamp);
    };
    requestAnimationFrame(setLatestRAFTimestamp);
  }

  flushPendingCanvasMutations() {
    this.pendingCanvasMutations.forEach(
      (_values: canvasMutationCommand[], canvas: HTMLCanvasElement) => {
        const id = this.mirror.getId(canvas);
        this.flushPendingCanvasMutationFor(canvas, id);
      },
    );
    requestAnimationFrame(() => this.flushPendingCanvasMutations());
  }

  flushPendingCanvasMutationFor(canvas: HTMLCanvasElement, id: number) {
    if (this.frozen || this.locked) {
      return;
    }

    const valuesWithType = this.pendingCanvasMutations.get(canvas);
    if (!valuesWithType || id === -1) return;

    const values = valuesWithType.map((value) => {
      const rest: Partial<canvasMutationWithType> = { ...value };
      delete rest.type;
      return rest;
    }) as canvasMutationCommand[];
    const { type } = valuesWithType[0];

    this.mutationCb({ id, type, commands: values });

    this.pendingCanvasMutations.delete(canvas);
  }
}
