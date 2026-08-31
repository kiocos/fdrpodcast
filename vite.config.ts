import { sites } from '@openai/sites-vite-plugin';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vite';

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig({
  plugins: [solid(), sites()],
  server: {
    host: '0.0.0.0',
    watch: isCodexSeatbeltSandbox
      ? { useFsEvents: false, usePolling: true }
      : undefined,
  },
  build: {
    target: 'es2022',
  },
});
