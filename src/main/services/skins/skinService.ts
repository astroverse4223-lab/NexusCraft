import { randomUUID } from 'node:crypto'
import { readFile, writeFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Account, SavedSkin } from '@shared/types'
import { db, Collections } from '../../core/database'
import { LauncherError } from '../../core/errors'
import { createLogger } from '../../core/logger'
import { skinsRoot, ensureDir } from '../../core/paths'
import { request } from '../../core/http'
import { getValidMinecraftToken } from '../auth/accountService'

const log = createLogger('skins')

const SKINS_ENDPOINT = 'https://api.minecraftservices.com/minecraft/profile/skins'
const ACTIVE_SKIN_ENDPOINT = 'https://api.minecraftservices.com/minecraft/profile/skins/active'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface PngInfo {
  width: number
  height: number
}

/** Reads the IHDR chunk to validate that this really is a Minecraft skin. */
function readPngInfo(data: Buffer): PngInfo | null {
  if (data.length < 24) return null
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  if (data.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

function validateSkinFile(data: Buffer): PngInfo {
  const info = readPngInfo(data)
  if (!info) {
    throw new LauncherError('INVALID_INPUT', 'file is not a PNG', {
      title: 'That file is not a PNG image',
      message: 'Minecraft skins must be PNG images. The file you chose is a different format.',
      actions: ['Choose a .png file exported from a skin editor']
    })
  }
  // Modern skins are 64x64; 64x32 is the pre-1.8 layout Mojang still accepts.
  const valid = (info.width === 64 && (info.height === 64 || info.height === 32)) || (info.width === 128 && info.height === 128)
  if (!valid) {
    throw new LauncherError('INVALID_INPUT', `unexpected skin size ${info.width}x${info.height}`, {
      title: 'That image is the wrong size for a skin',
      message: `Minecraft skins are 64x64 pixels (or 64x32 for the old layout). This image is ${info.width}x${info.height}.`,
      actions: ['Resize the image to 64x64', 'Or export it again from a skin editor']
    })
  }
  if (data.byteLength > 1024 * 1024) {
    throw new LauncherError('INVALID_INPUT', 'skin file is too large')
  }
  return info
}

/* --------------------------------------------------------------- library */

export function listSkins(): SavedSkin[] {
  return db()
    .all<SavedSkin>(Collections.skins)
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.addedAt - a.addedAt)
}

export async function importSkin(
  filePath: string,
  name: string,
  variant: 'classic' | 'slim'
): Promise<SavedSkin> {
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) throw new LauncherError('NOT_FOUND', 'that file no longer exists')

  const data = await readFile(filePath)
  validateSkinFile(data)

  const id = randomUUID()
  const stored = join(ensureDir(skinsRoot()), `${id}.png`)
  await writeFile(stored, data)

  const skin: SavedSkin = {
    id,
    name: name.trim().slice(0, 64) || 'Untitled skin',
    variant,
    dataUrl: `data:image/png;base64,${data.toString('base64')}`,
    favorite: false,
    addedAt: Date.now()
  }

  db().put(Collections.skins, id, skin)
  log.info(`imported skin "${skin.name}"`)
  return skin
}

export async function deleteSkin(id: string): Promise<void> {
  const skin = db().get<SavedSkin>(Collections.skins, id)
  if (!skin) throw new LauncherError('NOT_FOUND', 'that skin no longer exists')
  db().remove(Collections.skins, id)
  await rm(join(skinsRoot(), `${id}.png`), { force: true }).catch(() => undefined)
}

export function favoriteSkin(id: string, favorite: boolean): SavedSkin {
  const skin = db().get<SavedSkin>(Collections.skins, id)
  if (!skin) throw new LauncherError('NOT_FOUND', 'that skin no longer exists')
  const next = { ...skin, favorite }
  db().put(Collections.skins, id, next)
  return next
}

/* ---------------------------------------------------------------- apply */

/**
 * Uploads a skin through Mojang's official profile API. This is the same
 * endpoint minecraft.net uses; nothing about the account system is bypassed.
 */
export async function applySkin(account: Account, skinId: string): Promise<void> {
  const skin = db().get<SavedSkin>(Collections.skins, skinId)
  if (!skin) throw new LauncherError('NOT_FOUND', 'that skin no longer exists')

  const file = join(skinsRoot(), `${skinId}.png`)
  const data = await readFile(file).catch(() => null)
  if (!data) throw new LauncherError('NOT_FOUND', 'the stored skin image is missing')
  validateSkinFile(data)

  const token = await getValidMinecraftToken(account.id)

  const form = new FormData()
  form.append('variant', skin.variant)
  form.append('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'skin.png')

  const response = await request(SKINS_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    retries: 1,
    timeoutMs: 30_000
  })

  if (response.status === 401) throw new LauncherError('TOKEN_EXPIRED', 'skin upload was rejected')
  if (!response.ok) {
    throw new LauncherError('UNKNOWN', `skin upload returned HTTP ${response.status}`, {
      title: 'The skin could not be applied',
      message: 'Mojang rejected the skin upload. The image may not meet their requirements, or the service may be busy.',
      actions: ['Check the skin is a valid 64x64 PNG', 'Try again in a few minutes']
    })
  }

  log.info(`applied skin "${skin.name}" to ${account.username}`)
}

/** Removes the custom skin, returning the account to the default appearance. */
export async function resetSkin(account: Account): Promise<void> {
  const token = await getValidMinecraftToken(account.id)
  const response = await request(ACTIVE_SKIN_ENDPOINT, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    retries: 1
  })

  if (!response.ok && response.status !== 204) {
    throw new LauncherError('UNKNOWN', `skin reset returned HTTP ${response.status}`, {
      title: 'The skin could not be reset',
      message: 'Mojang did not accept the request to reset your skin.',
      actions: ['Try again shortly', 'Or reset it at minecraft.net/profile/skin']
    })
  }
  log.info(`reset skin for ${account.username}`)
}
