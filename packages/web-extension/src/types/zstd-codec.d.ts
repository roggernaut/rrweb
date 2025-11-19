declare module 'zstd-codec' {
  interface ZstdSimple {
    compress(content: Uint8Array, compressionLevel?: number): Uint8Array | null;
    decompress(content: Uint8Array): Uint8Array | null;
  }

  interface ZstdModule {
    Simple: new () => ZstdSimple;
  }

  export const ZstdCodec: {
    run(callback: (module: ZstdModule) => void): void;
  };
}
