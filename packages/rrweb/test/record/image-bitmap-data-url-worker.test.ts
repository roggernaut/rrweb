import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageBitmapDataURLWorkerParams } from '@rrweb/types';

type WorkerHandler = (event: {
  data: ImageBitmapDataURLWorkerParams;
}) => Promise<void>;

class FakeOffscreenCanvas {
  static latest: FakeOffscreenCanvas;
  pixels: Uint8ClampedArray;

  constructor(public width: number, public height: number) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
    FakeOffscreenCanvas.latest = this;
  }

  getContext() {
    return {
      drawImage: (bitmap: { pixels: Uint8ClampedArray }) =>
        this.pixels.set(bitmap.pixels),
      fillStyle: '',
      fillRect: (x: number, y: number, width: number, height: number) => {
        for (let row = y; row < y + height; row += 1) {
          for (let column = x; column < x + width; column += 1) {
            const offset = (row * this.width + column) * 4;
            this.pixels.set([0, 0, 0, 255], offset);
          }
        }
      },
    };
  }

  async convertToBlob(options?: { type?: string }) {
    const encoded = this.pixels.slice().buffer;
    return {
      type: options?.type || 'image/webp',
      arrayBuffer: async () => encoded,
    };
  }
}

describe('canvas encode worker privacy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { onmessage?: WorkerHandler }).onmessage;
  });

  it('paints mask regions black before encoding', async () => {
    const postMessage = vi.fn();
    vi.resetModules();
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('postMessage', postMessage);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    await import('../../src/record/workers/image-bitmap-data-url-worker');

    const pixels = Uint8ClampedArray.from({ length: 16 }, (_, i) => i + 1);
    const bitmap = { pixels, close: vi.fn() };
    await (globalThis as { onmessage: WorkerHandler }).onmessage({
      data: {
        id: 1,
        bitmap: bitmap as unknown as ImageBitmap,
        width: 2,
        height: 2,
        dataURLOptions: {},
        maskRegions: [{ x: 0, y: 0, width: 1, height: 2 }],
      },
    });

    expect(Array.from(FakeOffscreenCanvas.latest.pixels)).toEqual([
      0, 0, 0, 255, 5, 6, 7, 8, 0, 0, 0, 255, 13, 14, 15, 16,
    ]);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, base64: expect.any(String) }),
    );
  });
});
