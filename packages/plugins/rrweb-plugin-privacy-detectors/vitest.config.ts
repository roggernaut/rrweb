/// <reference types="vitest" />
import { defineProject, mergeConfig } from 'vitest/config';
import { resolve } from 'node:path';
import configShared from '../../../vitest.config.ts';

export default mergeConfig(
  configShared,
  defineProject({
    resolve: {
      alias: {
        'rrweb-snapshot': resolve(__dirname, '../../rrweb-snapshot/src'),
        '@rrweb/types': resolve(__dirname, '../../types/src'),
      },
    },
  }),
);
