import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

// Writes dist/sw.js from sw/sw.js with this build's file list and a build id, so an
// installed phone keeps exactly this build's files and drops the previous build's.
function phoneAppServiceWorker(): Plugin {
  return {
    name: 'nexgen-phone-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const template = readFileSync(path.resolve(__dirname, 'sw/sw.js'), 'utf8');
      const files = Object.keys(bundle).filter((file) => !file.endsWith('.map')).sort();
      if (!files.includes('index.html')) files.push('index.html');
      const hash = createHash('sha256').update(template);
      for (const file of files) {
        const item = bundle[file];
        if (!item) continue;
        hash.update(file);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      const source = template
        .replace('__BUILD__', hash.digest('hex').slice(0, 12))
        .replace('__FILES__', JSON.stringify(files));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), phoneAppServiceWorker()],
  base: '/mobile/',
  server: {
    port: 5174,
    host: true,
    allowedHosts: ['.ngrok-free.dev'],
  },
});
