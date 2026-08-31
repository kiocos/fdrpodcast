import { sites } from '@openai/sites-vite-plugin';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vite';

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    plugins: [
      solid(),
      sites(),
      cloudflare({ viteEnvironment: { name: 'server' } }),
    ],
    server: {
      host: '0.0.0.0',
      watch: isCodexSeatbeltSandbox
        ? { useFsEvents: false, usePolling: true }
        : undefined,
    },
    build: {
      target: 'es2022',
    },
  };
});
