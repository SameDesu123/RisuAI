import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import wasm from "vite-plugin-wasm";
import strip from '@rollup/plugin-strip';
import tailwindcss from '@tailwindcss/vite'
// https://vitejs.dev/config/
export default defineConfig(({command, mode}) => {
  const isTauriDebug = process.env.TAURI_ENV_DEBUG === 'true'
  const isLightweightAndroidBuild = process.env.VITE_ANDROID_CI_LIGHT === 'true'

  return {
    plugins: [
      svelte({
        onwarn: (warning, handler) => {
          // disable a11y warnings
          if (warning.code.startsWith("a11y-")) return;
          handler(warning);
        },
      }),
      // Vite performs the final CSS minification. Skipping Tailwind's extra
      // optimizer also avoids duplicate work during production builds.
      tailwindcss({ optimize: false }),
      wasm(),
      command === 'build' ? strip({
        include: '**/*.(mjs|js|svelte|ts)'
      }) : null
    ],

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    // prevent vite from obscuring rust errors
    clearScreen: false,
    // tauri expects a fixed port, fail if that port is not available
    server: {
      host: '0.0.0.0', // listen on all addresses
      port: 5174,
      strictPort: true,
      // hmr: false,
    },
    // to make use of `TAURI_ENV_DEBUG` and other env variables
    // https://v2.tauri.app/reference/environment-variables/
    envPrefix: ["VITE_", "TAURI_"],
    build: {
      target:'baseline-widely-available',
      // don't minify for debug builds
      minify: isTauriDebug && !isLightweightAndroidBuild ? false : 'oxc',
      // Lightning CSS currently reports valid Custom Highlight selectors as
      // unknown. esbuild preserves and minifies those selectors correctly.
      cssMinify: 'esbuild',
      // produce sourcemaps for debug builds
      sourcemap: isTauriDebug && !isLightweightAndroidBuild,
      chunkSizeWarningLimit: 2000,
    },
    
    optimizeDeps:{
      exclude: [
        "@browsermt/bergamot-translator"
      ],
      needsInterop:[
        "@mlc-ai/web-tokenizers"
      ]
    },

    resolve:{
      alias:{
        'src':'/src',
      }
    },
    worker: {
      format: 'es'
    }
}
});
