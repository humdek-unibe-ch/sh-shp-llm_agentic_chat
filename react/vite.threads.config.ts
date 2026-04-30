/**
 * Vite configuration for the AGENTIC CHAT THREADS UMD bundle.
 *
 * Output:
 *   ../js/ext/agentic-threads.umd.js
 *   ../js/ext/agentic-threads.css   (moved to ../css/ext/ by move-css.cjs)
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
      entry: resolve(__dirname, 'src/AgenticThreads.tsx'),
      name: 'AgenticThreads',
      fileName: () => 'agentic-threads.umd.js',
      formats: ['umd'],
    },
    rollupOptions: {
      output: {
        name: 'AgenticThreads',
        format: 'umd',
        inlineDynamicImports: true,
        entryFileNames: 'agentic-threads.umd.js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'agentic-threads.css';
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
