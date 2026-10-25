import { defineConfig } from '@playwright/test';

// Mobile responsive specs. Local only: the vite preview (port 4173) proxies
// /api to the temp API server (port 4001) with its own throwaway database.
// Nothing here reaches the public internet.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60 * 1000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node src/index.js',
      cwd: '../server',
      port: 4001,
      reuseExistingServer: false,
      env: {
        PORT: '4001',
        DATA_DIR: '/tmp/upscaleai-mobile-e2e/data',
        DB_PATH: '/tmp/upscaleai-mobile-e2e/data/jobs.db',
        UPSCALE_ADMIN_EMAIL: 'admin@e2e.local',
        UPSCALE_ADMIN_PASSWORD: 'AdminPass123',
      },
    },
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      port: 4173,
      reuseExistingServer: false,
    },
  ],
});
