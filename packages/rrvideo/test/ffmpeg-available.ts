import { spawnSync } from 'child_process';

export function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version']).status === 0;
}
