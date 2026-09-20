import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5173', ...devices['Pixel 7'] },
  webServer: [
    {
      command: 'corepack pnpm --filter @plantry/backend dev',
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
      cwd: '../..',
    },
    {
      command: 'corepack pnpm --filter @plantry/frontend dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      cwd: '../..',
    },
  ],
});
