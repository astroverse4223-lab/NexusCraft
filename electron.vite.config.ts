import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/*
 * The Microsoft application id this build signs in as.
 *
 * Baked in from the environment so a launcher can be handed to someone who has
 * registered nothing. It is not a credential — sign-in uses PKCE with no client
 * secret — and an empty default keeps source builds asking for one, which is
 * what a developer building from source should get.
 */
const bundledClientId = JSON.stringify(process.env.NEXUSCRAFT_CLIENT_ID?.trim() ?? '')

export default defineConfig({
  main: {
    define: { BUNDLED_CLIENT_ID: bundledClientId },
    plugins: [externalizeDepsPlugin({ exclude: [] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // The companion bot runs as its own process, so it is bundled
          // separately and spawned rather than imported.
          bot: resolve(__dirname, 'src/main/companion/botEntry.ts'),
          // Speech synthesis, for the same reason as the bot: it is heavy
          // enough that running it in the main process freezes the window.
          voice: resolve(__dirname, 'src/main/services/voice/voiceWorker.ts')
        },
        /*
         * Left for Node to require at runtime rather than bundled.
         *
         * Anything with a native binary has to be here. onnxruntime-node finds
         * its own `.node` file with a dynamic require built from the platform
         * name, and a bundler cannot follow that — it inlines the JavaScript,
         * the computed path stops pointing at anything, and the first attempt
         * to load a voice fails with "Could not dynamically require
         * ../bin/napi-v3/win32/x64/onnxruntime_binding.node".
         *
         * That failure only appears in a built app. Running the same source
         * directly works, because nothing has been bundled yet — which is
         * exactly how it got missed.
         *
         * sharp comes in under @huggingface/transformers and is native for the
         * same reason.
         */
        external: [
          'better-sqlite3',
          'mineflayer',
          'mineflayer-pathfinder',
          'minecraft-data',
          'vec3',
          'kokoro-js',
          '@huggingface/transformers',
          'onnxruntime-node',
          'onnxruntime-web',
          'onnxruntime-common',
          'phonemizer',
          'sharp'
        ]
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
