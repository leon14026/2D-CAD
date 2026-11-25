import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const isCi = Boolean(process.env['CI']);

/**
 * Browser tests run against the production build in Chromium with the GPU switched off
 * and the software rasteriser for WebGL disabled: if ArchiLite works here, it works on any
 * laptop without a dedicated graphics card.
 *
 * Locally, set CHROME_PATH to use an installed Chrome instead of Playwright's download.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: 0,
  reporter: isCi ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !isCi,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium-no-gpu',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(process.env['CHROME_PATH'] ? { executablePath: process.env['CHROME_PATH'] } : {}),
          args: ['--disable-gpu', '--disable-software-rasterizer'],
        },
      },
    },
  ],
});
