/**
 * Vite configuration for the AGENTIC CHAT ADMIN UMD bundle.
 *
 * Output:
 *   ../js/ext/agentic-admin.umd.js
 *   ../js/ext/agentic-admin.css   (moved to ../css/ext/ by move-css.cjs)
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
      entry: resolve(__dirname, 'src/AgenticAdmin.tsx'),
      name: 'AgenticAdmin',
      fileName: () => 'agentic-admin.umd.js',
      formats: ['umd'],
    },
    rollupOptions: {
      output: {
        name: 'AgenticAdmin',
        format: 'umd',
        inlineDynamicImports: true,
        entryFileNames: 'agentic-admin.umd.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'agentic-admin.css';
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
