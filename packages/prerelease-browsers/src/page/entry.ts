declare global {
  interface Window {
    __prerelease: { version: number };
  }
}

window.__prerelease = { version: 1 };

export {};
