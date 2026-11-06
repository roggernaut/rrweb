import type { Engine } from '../types.ts';
import { launchPlaywright } from './drivers/playwright.ts';
import type { PageDriver } from './drivers/types.ts';

export interface TargetDefinition {
  id: string;
  engine: Engine;
  channel: 'upcoming' | 'stable';
  pairGroup?: string;
  where:
    | 'local'
    | 'github-linux'
    | 'github-macos'
    | 'github-android'
    | 'browserstack';
  checks: 'all' | 'focused' | 'functional-privacy';
  perf: 'compare' | 'ceiling-only' | 'none';
  perfSamples: number; // 5 on GitHub, 3 on BrowserStack
  timeScale: number; // multiplies every timeout: 1 GitHub, 5 BrowserStack
  ceilingMs?: number;
  connect(): Promise<PageDriver>;
}

function localTarget(id: string, engine: Engine): TargetDefinition {
  return {
    id,
    engine,
    channel: 'stable',
    where: 'local',
    checks: 'all',
    perf: 'ceiling-only',
    perfSamples: 5,
    timeScale: 1,
    connect: () => launchPlaywright({ engine }),
  };
}

/** The bundled Playwright engines, for running a target on a developer machine. */
export const localTargets: TargetDefinition[] = [
  localTarget('local-chromium', 'chromium'),
  localTarget('local-firefox', 'gecko'),
  localTarget('local-webkit', 'webkit'),
];

const targets: TargetDefinition[] = [...localTargets];

export function findTarget(id: string): TargetDefinition {
  const found = targets.find((t) => t.id === id);
  if (!found) {
    throw new Error(
      `unknown target "${id}"; known targets: ${targets
        .map((t) => t.id)
        .join(', ')}`,
    );
  }
  return found;
}
