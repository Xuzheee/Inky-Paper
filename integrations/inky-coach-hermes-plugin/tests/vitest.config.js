import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@hermes/plugin-sdk': fileURLToPath(new URL('./sdk-fixture.js', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['integrations/inky-coach-hermes-plugin/tests/*.test.jsx'] },
});
