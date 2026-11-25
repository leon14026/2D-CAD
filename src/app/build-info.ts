declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;

/** Version and commit, injected at build time by vite.config.ts. */
export const buildInfo = {
  version: __APP_VERSION__,
  sha: __BUILD_SHA__,
} as const;
