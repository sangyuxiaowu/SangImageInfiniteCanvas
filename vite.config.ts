import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const isTauriMode = mode === 'tauri';
  const env = loadEnv(mode, '.', '');
  let base = env.VITE_BASE || '/';
  if (!base.endsWith('/')) {
    base += '/';
  }

  const plugins = [react(), tailwindcss()];

  if (!isTauriMode) {
    plugins.push(VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Sang Image 创意画板',
        short_name: 'Sang Image',
        description: '基于无限画布的 AI 图像创作工作台。',
        lang: 'zh-CN',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        icons: [
          {
            src: `${base}pwa-icon.svg`,
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
    }));
  }

  return {
    base,
    plugins: plugins,
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      watch: {
        ignored: ['**/docs/**', '**/dist/**', '**/build/**', '**/node_modules/**', '**/scripts/**']
      },
    },
  };
});
