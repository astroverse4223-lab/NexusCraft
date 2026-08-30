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
          bot: resolve(__dirname, 'src/main/companion/botEntry.ts')
        },
        external: ['better-sqlite3', 'mineflayer', 'mineflayer-pathfinder', 'minecraft-data', 'vec3']
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
