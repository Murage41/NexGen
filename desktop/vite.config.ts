import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const isElectron = process.env.ELECTRON === 'true' || process.env.npm_lifecycle_event === 'build';

export default defineConfig(async () => {
  const plugins: any[] = [react()];

  if (isElectron) {
    const electron = (await import('vite-plugin-electron')).default;
    const electronRenderer = (await import('vite-plugin-electron-renderer')).default;
    plugins.push(
      electron([
        {
          entry: 'src/main/index.ts',
          vite: {
            build: {
              rollupOptions: {
                output: {
                  entryFileNames: 'main.js',
                },
              },
            },
          },
        },
        {
          entry: 'src/preload/index.ts',
          onstart(args: any) { args.reload(); },
          vite: {
            build: {
              rollupOptions: {
                output: {
                  entryFileNames: 'preload.js',
                },
              },
            },
          },
        },
      ]),
      electronRenderer(),
    );
  }

  return {
    plugins,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src/renderer'),
      },
    },
  };
});
