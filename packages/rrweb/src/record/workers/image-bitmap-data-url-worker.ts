import { encode } from 'base64-arraybuffer';
import type {
  DataURLOptions,
  ImageBitmapDataURLWorkerParams,
  ImageBitmapDataURLWorkerResponse,
} from '@rrweb/types';

const lastBlobMap: Map<number, string> = new Map();
const transparentBlobMap: Map<string, string> = new Map();
const lastSentAtMap: Map<number, number> = new Map();
const MASKED_KEYFRAME_INTERVAL_MS = 30_000;

export interface ImageBitmapDataURLRequestWorker {
  postMessage: (
    message: ImageBitmapDataURLWorkerParams,
    transfer?: [ImageBitmap],
  ) => void;
  onmessage: (message: MessageEvent<ImageBitmapDataURLWorkerResponse>) => void;
  onerror?: ((event: ErrorEvent) => unknown) | null;
  terminate?: () => void;
}

interface ImageBitmapDataURLResponseWorker {
  onmessage:
    | null
    | ((message: MessageEvent<ImageBitmapDataURLWorkerParams>) => void);
  postMessage(e: ImageBitmapDataURLWorkerResponse): void;
}

async function getTransparentBlobFor(
  width: number,
  height: number,
  dataURLOptions: DataURLOptions,
): Promise<string> {
  const id = `${width}-${height}`;
  if ('OffscreenCanvas' in globalThis) {
    if (transparentBlobMap.has(id)) return transparentBlobMap.get(id)!;
    const offscreen = new OffscreenCanvas(width, height);
    offscreen.getContext('2d'); // creates rendering context for `converToBlob`
    const blob = await offscreen.convertToBlob(dataURLOptions); // takes a while
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = encode(arrayBuffer); // cpu intensive
    transparentBlobMap.set(id, base64);
    return base64;
  } else {
    return '';
  }
}

// `as any` because: https://github.com/Microsoft/TypeScript/issues/20595
const worker: ImageBitmapDataURLResponseWorker = self;

// eslint-disable-next-line @typescript-eslint/no-misused-promises
worker.onmessage = async function (e) {
  if ('resetFrameDedup' in e.data) {
    lastBlobMap.clear();
    return;
  }
  if ('OffscreenCanvas' in globalThis) {
    const { id, bitmap, width, height, dataURLOptions, maskRegions } = e.data;
    let bitmapClosed = false;
    try {
      const transparentBase64 = getTransparentBlobFor(
        width,
        height,
        dataURLOptions,
      );

      const offscreen = new OffscreenCanvas(width, height);
      const ctx = offscreen.getContext('2d')!;

      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      bitmapClosed = true;
      if (maskRegions !== undefined) {
        ctx.fillStyle = 'black';
        for (const region of maskRegions) {
          ctx.fillRect(region.x, region.y, region.width, region.height);
        }
      }
      const blob = await offscreen.convertToBlob(dataURLOptions); // takes a while
      const type = blob.type;
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = encode(arrayBuffer); // cpu intensive

      // on first try we should check if canvas is transparent,
      // no need to save its contents in that case
      if (!lastBlobMap.has(id) && (await transparentBase64) === base64) {
        lastBlobMap.set(id, base64);
        return worker.postMessage({ id });
      }

      if (lastBlobMap.get(id) === base64) {
        const lastSentAt = lastSentAtMap.get(id);
        const keyframeDue =
          maskRegions !== undefined &&
          lastSentAt !== undefined &&
          Date.now() - lastSentAt >= MASKED_KEYFRAME_INTERVAL_MS;
        if (!keyframeDue) return worker.postMessage({ id }); // unchanged
      }
      worker.postMessage({
        id,
        type,
        base64,
        width,
        height,
      });
      lastBlobMap.set(id, base64);
      lastSentAtMap.set(id, Date.now());
    } catch {
      if (!bitmapClosed) bitmap.close();
      // Always respond so the main thread releases the in-progress latch.
      return worker.postMessage({ id });
    }
  } else {
    e.data.bitmap.close();
    return worker.postMessage({ id: e.data.id });
  }
};
