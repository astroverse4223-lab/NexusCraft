import { describe, it } from 'vitest'
import { pingServer } from '../../src/main/services/servers/mcPing'
import { BUNDLED_DIRECTORY } from '../../src/main/services/servers/serverCatalogue'

/**
 * A live check, deliberately NOT part of the suite (`.check.ts`, not
 * `.test.ts`, so the `test/**\/*.test.ts` include never picks it up).
 *
 * Run it by hand to see which bundled entries still answer:
 *   npx vitest run test/servers/catalogueLive.check.ts
 */
describe('bundled catalogue', () => {
  it(
    'reports which servers answer a ping',
    async () => {
      const rows: string[] = []
      let online = 0

      for (let i = 0; i < BUNDLED_DIRECTORY.length; i += 8) {
        const batch = BUNDLED_DIRECTORY.slice(i, i + 8)
        const results = await Promise.all(
          batch.map(async (entry) => ({ entry, result: await pingServer(entry.address, entry.port, 8000) }))
        )
        for (const { entry, result } of results) {
          if (result.online) {
            online += 1
            rows.push(
              `  UP    ${entry.name.padEnd(18)} ${entry.address.padEnd(28)} ` +
                `${String(result.playersOnline ?? '?').padStart(7)} players  ${result.versionName ?? ''}`
            )
          } else {
            rows.push(`  DOWN  ${entry.name.padEnd(18)} ${entry.address.padEnd(28)} ${result.error}`)
          }
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        `\n${online}/${BUNDLED_DIRECTORY.length} bundled servers answered\n${rows.sort().join('\n')}\n`
      )
    },
    120_000
  )
})
