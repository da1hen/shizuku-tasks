import { defineConfig, devices } from '@playwright/test';

const useInstalledChrome = process.env.SHIZUKU_TEST_CHANNEL;
const browser = useInstalledChrome ? { channel: useInstalledChrome } : {};
export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.js',
  retries: 0,
  use: { baseURL: 'http://localhost:8787', ...browser },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], ...browser } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], ...browser } },
  ],
  webServer: {
    command: 'npm run db:local && npm run dev',
    url: 'http://localhost:8787/api/session',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
