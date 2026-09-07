import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { diagnoseCrash } from '../../src/main/services/launch/crashReport'

/**
 * The crash that fires every time you leave a server on a Forge instance.
 *
 * Disconnecting fires a logout event, Forge Config API Port answers it by
 * unloading configs, and unloading tries to save a config the server sent —
 * which lives in memory and has no file behind it. The cast fails and the game
 * takes a crash report on the way out, after the world is already saved.
 *
 * The launcher recognised this all along. What it showed was "Exit code
 * 4294967295. Open the log for details." — the explanation reached the instance
 * screen and never reached the message that actually popped up.
 *
 * The lines below are the ones that matter from a real report.
 */
const REPORT = `---- Minecraft Crash Report ----
// Oh - I know what I did wrong!

Time: 2026-09-04 17:24:12
Description: Unexpected error

java.lang.ClassCastException: class com.electronwill.nightconfig.core.SimpleCommentedConfig cannot be cast to class com.electronwill.nightconfig.core.file.CommentedFileConfig
	at net.minecraftforge.fml.config.ModConfig.save(ModConfig.java:80)
	at net.minecraftforge.fml.config.ConfigTracker.closeConfig(ConfigTracker.java:94)
	at net.minecraftforge.fml.config.ConfigTracker.unloadConfigs(ConfigTracker.java:63)
	at fuzs.forgeconfigapiport.forge.impl.neoforge.NeoForgeConfigSpecAdapter.lambda$registerEventHandlers$4(NeoForgeConfigSpecAdapter.java:59)
	at net.minecraftforge.client.event.ForgeEventFactoryClient.firePlayerLogout(ForgeEventFactoryClient.java:185)
`

async function diagnose(text: string) {
  const gameDir = await mkdtemp(join(tmpdir(), 'crash-'))
  await mkdir(join(gameDir, 'crash-reports'), { recursive: true })
  await writeFile(join(gameDir, 'crash-reports', 'crash-client.txt'), text, 'utf8')

  // `since` is the launch time; the report must look newer than it.
  return diagnoseCrash({ gameDir } as never, Date.now() - 60_000)
}

describe('the crash on disconnecting from a server', () => {
  it('is recognised rather than reported as an exit code', async () => {
    const crash = await diagnose(REPORT)

    expect(crash.reportPath).toBeTruthy()
    expect(crash.explanation).toBeTruthy()
    expect(crash.explanation).toContain('while disconnecting')
  })

  it('says the world is safe, which is the thing worth knowing', async () => {
    const crash = await diagnose(REPORT)
    expect(crash.explanation).toMatch(/already saved/i)
  })

  it('names Forge Config API Port so the mod can be found', async () => {
    const crash = await diagnose(REPORT)
    expect(crash.actions.join(' ')).toContain('Forge Config API Port')
  })

  it('still reports an unrecognised crash without inventing a cause', async () => {
    const crash = await diagnose(
      '---- Minecraft Crash Report ----\nDescription: Something else entirely\n\njava.lang.IllegalStateException: no idea\n'
    )

    expect(crash.reportPath).toBeTruthy()
    expect(crash.explanation).toBeNull()
    expect(crash.cause).toContain('IllegalStateException')
  })

  it('reports nothing when no report was written', async () => {
    const gameDir = await mkdtemp(join(tmpdir(), 'crash-'))
    const crash = await diagnoseCrash({ gameDir } as never, Date.now() - 60_000)
    expect(crash.reportPath).toBeNull()
  })
})
