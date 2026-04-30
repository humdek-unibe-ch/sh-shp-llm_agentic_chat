/**
 * Vite configuration for the AGENTIC CHAT (frontend) UMD bundle.
 *
 * Output:
 *   ../js/ext/agentic-chat.umd.js
 *   ../js/ext/agentic-chat.css   (moved to ../css/ext/ by move-css.cjs)
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],

  define: {
    'process.env': {},
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },

  build: {
    lib: {
      entry: resolve(__dirname, 'src/AgenticChat.tsx'),
      name: 'AgenticChat',
      fileName: () => 'agentic-chat.umd.js',
      formats: ['umd'],
    },
    rollupOptions: {
      output: {
        name: 'AgenticChat',
        format: 'umd',
        inlineDynamicImports: true,
        entryFileNames: 'agentic-chat.umd.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'agentic-chat.css';
          }
          return assetInfo.name || 'assets/[name][extname]';
        },
      },
    },
    outDir: '../js/ext',
    emptyOutDir: false,
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true,
      },
      format: {
        comments: false,
      },
    },
    cssCodeSplit: false,
  },

  server: {
    port: 3010,
    proxy: {
      '/index.php': {
        target: 'http://localhost/selfhelp',
        changeOrigin: true,
      },
    },
  },

  css: {
    modules: {
      localsConvention: 'camelCase',
    },
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
