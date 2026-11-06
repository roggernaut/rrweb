import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { CheckMeta } from '../types.ts';

const entryPoint = fileURLToPath(new URL('../page/entry.ts', import.meta.url));
const defaultDistDir = fileURLToPath(
  new URL('../../../rrweb/dist', import.meta.url),
);

let cachedBundle: Promise<string> | undefined;

/** Bundles the in-page check code into one IIFE string, once per process. */
export function buildPageBundle(): Promise<string> {
  cachedBundle ??= build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    sourcemap: false,
  }).then((result) => result.outputFiles[0].text);
  return cachedBundle;
}

/** Reads rrweb's UMD build from disk; package exports hide this file. */
export function readRrwebUmd(
  distDir: string = process.env.RRWEB_DIST ?? defaultDistDir,
): string {
  try {
    return readFileSync(`${distDir}/rrweb.umd.cjs`, 'utf8');
  } catch {
    throw new Error(
      'rrweb is not built: run yarn turbo run prepublish --filter=rrweb',
    );
  }
}

/** Keeps an inlined source from closing its own script element. */
export function escapeInlineScript(source: string): string {
  return source.replace(/<\/script/gi, (match) => `<\\/${match.slice(2)}`);
}

export function composePage(
  meta: CheckMeta,
  pageBundle: string,
  rrwebUmd: string,
): string {
  const id = JSON.stringify(meta.id);
  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<title>rrweb prerelease: ${meta.id}</title>`,
    meta.head ?? '',
    `<script>${escapeInlineScript(pageBundle)}</script>`,
    `<script>__prerelease.beforeRrweb(${id})</script>`,
    `<script>${escapeInlineScript(rrwebUmd)}</script>`,
    meta.startDuringLoad
      ? `<script>__prerelease.start(${id}, {})</script>`
      : '',
    '<body></body>',
  ].join('\n');
}
