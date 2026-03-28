import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const isElectron = process.env.ELECTRON === 'true';

export default defineConfig(async () => {
  const plugins: any[] = [react()];

  if (isElectron) {
    const electron = (await import('vite-plugin-electron')).default;
    const electronRenderer = (await import('vite-plugin-electron-renderer')).default;
    plugins.push(
      electron([
        { entry: 'src/main/index.ts' },
        {
          entry: 'src/preload/index.ts',
          onstart(args: any) { args.reload(); },
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
