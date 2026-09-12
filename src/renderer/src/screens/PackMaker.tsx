import {
  Boxes,
  Globe,
  Hammer,
  HardHat,
  Image as ImageIcon,
  Monitor,
  Music,
  Plus,
  Save,
  Server,
  Shield,
  Trash2,
  Upload
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { type JSX, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BASE_ITEMS,
  COSMETIC_HATS,
  MUSIC_DISCS,
  PANORAMA_FACES,
  SOUND_EVENTS,
  type PackItem,
  type PackSound,
  type PackTexture,
  type ResourcePackDraft,
  ARMOUR_BASES,
  ARMOUR_PIECES,
  emptyDraft,
  giveArmour,
  isEmpty,
  packSummary,
  safeId,
  type PackArmour
} from '@shared/resourcePacks'
import type { BuiltPack, PackForwarding, PackHostStatus } from '@shared/resourcePacks'
import type { Instance, LauncherErrorPayload, SavedCreation } from '@shared/types'
import { api, toPayload } from '../api'
import { renderIconArt } from '../lib/iconArt'
import { restyle } from '../lib/restyle'
import { toOggVorbis } from '../lib/toOgg'
import { RECIPE_PRESETS, type TextureRecipe } from '@shared/textureRecipe'
import { ErrorView, Spinner } from '../components/ui'
import { useStore } from '../store/useStore'

/**
 * Making a resource pack, rather than downloading one.
 *
 * The pack is the only way to change how something looks or sounds for
 * everybody on a server at once, and it is the one kind of content the
 * launcher could not previously produce. Everything here writes plain files
 * into a zip - nothing is compiled and nothing is a mod.
 */

/** The parts of a resource pack, each its own screen. */
type PackTab = 'textures' | 'items' | 'hats' | 'armour' | 'sounds' | 'menu' | 'saved' | 'build'

/*
 * In the order the job is done, with the thing that produces a file last.
 */
const PACK_TABS: { id: PackTab; label: string; icon: LucideIcon }[] = [
  { id: 'textures', label: 'Textures', icon: ImageIcon },
  { id: 'items', label: 'Items', icon: Boxes },
  { id: 'hats', label: 'Hats', icon: HardHat },
  { id: 'armour', label: 'Armour', icon: Shield },
  { id: 'sounds', label: 'Sounds', icon: Music },
  { id: 'menu', label: 'Menu', icon: Monitor },
  { id: 'saved', label: 'Saved', icon: Save },
  { id: 'build', label: 'Build', icon: Hammer }
]

/** The eight ids the Hats tab owns. */
const HAT_IDS: ReadonlySet<string> = new Set(COSMETIC_HATS.map((hat) => hat.id))

/**
 * How much is in the pack, per tab.
 *
 * Carried on the tab itself because the whole point of splitting the screen up
 * is that you can no longer see the other six - and a pack you thought was
 * empty having four textures in it is exactly the surprise this is meant to
 * stop.
 */
/**
 * How many texture thumbnails are drawn at once.
 *
 * A restyled pack holds thousands and the browser decodes and keeps an image
 * for every one it is shown. The box above them is how you reach the rest.
 */
const SHOWN_TEXTURES = 150

function countFor(tab: PackTab, draft: ResourcePackDraft): number {
  if (tab === 'textures') return draft.textures.length
  if (tab === 'sounds') return draft.sounds.length
  if (tab === 'armour') return draft.armour.length
  if (tab === 'menu') return (draft.panorama ? 1 : 0) + (draft.logo ? 1 : 0)

  /*
   * A hat is an item. The Hats tab is a shortcut for drawing eight particular
   * ones, and they land in draft.items like anything else - so the Items tab
   * lists them too, and each count is right for the tab it sits on rather
   * than for a share of some total.
   */
  if (tab === 'hats') return draft.items.filter((item) => HAT_IDS.has(item.id)).length
  if (tab === 'items') return draft.items.filter((item) => !HAT_IDS.has(item.id)).length

  return 0
}

/** A png the game can use, read from a file the user picked. */
async function readPng(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('could not read that image'))
    reader.readAsDataURL(file)
  })
}

/**
 * Any image, as a square png of the right size.
 *
 * Item textures are 16 by 16 and anything else is stretched by the game with
 * no say in how; panorama faces want a big square. Doing it here means a photo
 * dropped in comes out as something Minecraft can actually use rather than as
 * a pack that loads and looks wrong.
 */
async function toSquarePng(file: File, size: number): Promise<string> {
  const source = new Image()
  source.src = await readPng(file)
  await source.decode()

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')

  // Cover rather than stretch, so nothing comes out squashed.
  const scale = Math.max(size / source.width, size / source.height)
  const w = source.width * scale
  const h = source.height * scale

  ctx.imageSmoothingEnabled = size > 32
  ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h)

  return canvas.toDataURL('image/png')
}

/**
 * Styles worth trying on all eight at once.
 *
 * One word rather than a full description, because this is applied to every
 * hat - "a dark circle with a yellow diamond" is a fine icon prompt and a poor
 * instruction for eight different objects.
 */
const HAT_STYLES = [
  'neon',
  'medieval',
  'cursed',
  'golden',
  'glowing crystal',
  'cardboard',
  'stone carved',
  'candy'
] as const

interface Target {
  id: string
  label: string
  kind: 'server' | 'instance'
  serverId?: string

  /**
   * Which Minecraft the pack is for.
   *
   * Not a detail. The textures being restyled are read out of a version's own
   * jar, and the pack format written into pack.mcmeta comes from wherever it
   * is going - so a pack for a 26.2 server built from an instance's 1.21.11
   * textures is restyling the wrong three thousand files, missing the several
   * hundred 26.2 added, and saying "1.21.11" on a screen aimed at a 26.2
   * server.
   */
  minecraftVersion: string
}

/**
 * The replaced textures, listed.
 *
 * Its own component, and memoised, because of what sits around it: a restyle
 * reports progress a hundred and thirty-nine times, and every one of those
 * re-rendered this. A whole-pack restyle replaces about two thousand eight
 * hundred textures, so that was a couple of thousand rows reconciled a hundred
 * and thirty-nine times over - while the work was running, which is exactly
 * when the window needs to stay answerable.
 *
 * Memoising is enough because the draft is replaced rather than edited, so the
 * array is the same object for the whole run and this redraws only when the
 * textures themselves actually change.
 */
const TextureList = memo(function TextureList({
  textures,
  onRemove
}: {
  textures: PackTexture[]
  onRemove: (path: string) => void
}): JSX.Element {
  const [filter, setFilter] = useState('')

  const matching = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return needle ? textures.filter((one) => one.path.toLowerCase().includes(needle)) : textures
  }, [textures, filter])

  /*
   * Only a screenful is drawn.
   *
   * Two thousand eight hundred thumbnails is two thousand eight hundred images
   * for the browser to decode and keep, and nobody finds anything by scrolling
   * that far anyway - which is what the box above them is for.
   */
  const shown = matching.slice(0, SHOWN_TEXTURES)
  const hidden = matching.length - shown.length

  return (
    <>
      {textures.length > SHOWN_TEXTURES && (
        <input
          className="input"
          placeholder={`Find among ${textures.length.toLocaleString()} textures`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      <div className="row gap-8 wrap">
        {shown.map((texture) => (
          <div key={texture.path} className="row gap-6" style={{ alignItems: 'center' }} title={texture.path}>
            <img
              src={texture.image}
              alt=""
              width={22}
              height={22}
              style={{ imageRendering: 'pixelated', borderRadius: 3 }}
            />
            <span className="tiny dim">{texture.path.slice(texture.path.lastIndexOf('/') + 1)}</span>
            <button className="btn btn-sm" onClick={() => onRemove(texture.path)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {hidden > 0 && (
        <p className="tiny dim">
          {hidden.toLocaleString()} more not shown{filter ? ' that match' : ''}. Type above to find one.
        </p>
      )}

      {matching.length === 0 && filter && <p className="tiny dim">Nothing matches &ldquo;{filter}&rdquo;.</p>}
    </>
  )
})

export function PackMakerTab({ instance }: { instance: Instance }): JSX.Element {
  const draft = useStore((state) => state.resourcePack)
  const setDraft = useStore((state) => state.setResourcePack)

  /**
   * Merges into the draft as it is now, not as it was when the work started.
   *
   * Everything on this screen that touches many textures is slow - importing
   * a folder is three thousand file reads, restyling one is three thousand
   * canvases - and each of them was building its result from the `draft` its
   * closure captured before any of that began. Two of them overlapping meant
   * whichever finished last wrote its own stale copy over the other, and the
   * only evidence was a pack that came out looking exactly like vanilla.
   */
  const mergeDraft = (make: (current: ResourcePackDraft) => Partial<ResourcePackDraft>): void =>
    setDraft(make(useStore.getState().resourcePack))

  /*
   * Stable between renders, so the memoised list below stays memoised.
   *
   * A fresh arrow function every render would be a new prop every render, and
   * the list would redraw for each of a restyle's progress reports - which is
   * the whole thing being avoided.
   */
  const removeTexture = useCallback(
    (path: string) => setDraft({ textures: useStore.getState().resourcePack.textures.filter((t) => t.path !== path) }),
    [setDraft]
  )

  const [targets, setTargets] = useState<Target[]>([])
  const [targetId, setTargetId] = useState('')

  const [port, setPort] = useState(25567)
  const [required, setRequired] = useState(false)
  const [address, setAddress] = useState('')

  /**
   * Which address goes into server.properties.
   *
   * Not a detail: a home router that will not route you back to your own
   * public address makes the internet answer unusable from the machine that
   * built the pack - the server publishes a url the person testing it can
   * never fetch, and all they are told is that the download failed.
   */
  const [reachFor, setReachFor] = useState<'house' | 'internet' | 'typed'>('house')

  /*
   * A built pack, plus the two things only serving one can report: whether the
   * running server was told about it, so the screen does not ask for a restart
   * that already happened.
   */
  const [built, setBuilt] = useState<(BuiltPack & { offering?: boolean }) | null>(null)
  const [url, setUrl] = useState('')
  const [reach, setReach] = useState<{ ok: boolean; alternative: string | null } | null>(null)
  const [host, setHost] = useState<PackHostStatus | null>(null)
  const [forwarding, setForwarding] = useState<PackForwarding | null>(null)
  const [asking, setAsking] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const itemPick = useRef<HTMLInputElement>(null)
  const logoPick = useRef<HTMLInputElement>(null)
  const facePick = useRef<HTMLInputElement>(null)
  const [face, setFace] = useState(0)

  const hatPick = useRef<HTMLInputElement>(null)
  const [hat, setHat] = useState(0)

  const [vanilla, setVanilla] = useState<string[]>([])
  const [hunt, setHunt] = useState('')
  const [aiming, setAiming] = useState<string | null>(null)
  const texPick = useRef<HTMLInputElement>(null)
  const soundPick = useRef<HTMLInputElement>(null)
  const bulkPick = useRef<HTMLInputElement>(null)
  const folderPick = useRef<HTMLInputElement>(null)
  const [filed, setFiled] = useState<{ took: number; missed: string[] } | null>(null)

  const [saved, setSaved] = useState<SavedCreation[]>([])

  /** What the style does to a handful of textures, before it does it to a thousand. */
  const [preview, setPreview] = useState<{ path: string; before: string; after: string }[]>([])

  const [style, setStyle] = useState<TextureRecipe | null>(null)
  const [look, setLook] = useState('')
  const [folder, setFolder] = useState('block')
  const [working, setWorking] = useState<string | null>(null)

  /**
   * How far through, and what happened when it stopped.
   *
   * Restyling everything is nearly three thousand textures and about a minute,
   * and a spinner on a button says neither how long is left nor whether it
   * worked. A run that finishes silently is one somebody stares at wondering
   * whether to click again.
   */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)

  const [tab, setTab] = useState<PackTab>('textures')
  const top = useRef<HTMLDivElement>(null)

  const [armourBase, setArmourBase] = useState<string>('diamond')
  const [armourName, setArmourName] = useState('')
  const [forging, setForging] = useState(false)

  /** Which destructive button has been pressed once, so nothing goes on one click. */
  const [confirming, setConfirming] = useState<'pack' | 'textures' | null>(null)

  /** What is being converted, and how far along, so a long track is not a freeze. */
  const [converting, setConverting] = useState<{ name: string; done: number } | null>(null)

  /** Why the draft is not being kept, when it is not. */
  const [keepFailed, setKeepFailed] = useState<string | null>(null)

  /*
   * The saved pack this draft came from, if any.
   *
   * Without it every press of Save wrote a new row, so the ordinary way of
   * working - draw the hats, save, change one, save again - left a column of
   * identical thumbnails all called "Nexus" and no way to tell which was the
   * newest. Saving should mean saving, and only an unsaved pack should become
   * a new entry.
   */
  const [openId, setOpenId] = useState<string | null>(null)
  const [brains, setBrains] = useState<{ id: string; label: string }[]>([])
  const [brain, setBrain] = useState('')
  const [wish, setWish] = useState('')
  const [thinking, setThinking] = useState<string | null>(null)
  const [tries, setTries] = useState<Record<string, number>>({})

  /*
   * Kept as it changes, without anybody pressing anything.
   *
   * Three seconds after the last edit rather than on every one: a pack with
   * three thousand textures in it is megabytes, and writing that on each
   * keystroke would be slower than the work being done. Pressing Save is still
   * how you keep several packs - this is only so that closing the launcher
   * does not cost you the one in front of you.
   */
  useEffect(() => {
    if (isEmpty(draft)) return

    const timer = setTimeout(() => {
      void api.resourcePack
        .remember(draft)
        .then(() => setKeepFailed(null))
        .catch((err) => {
          /*
           * Quiet, but not silent.
           *
           * This swallowed everything, so when the payload cap started
           * refusing every save the screen went on looking like a screen that
           * was keeping your work. It is not worth a dialog - it is worth a
           * line saying so, next to the name of the thing not being kept.
           */
          setKeepFailed(toPayload(err).title)
        })
    }, 3000)

    return () => clearTimeout(timer)
  }, [draft])

  /** Replaces one vanilla texture with a picture off disk. */
  const swap = async (path: string, file: File): Promise<void> => {
    try {
      const image = await readPng(file)

      const texture: PackTexture = { path, image }

      mergeDraft((current) => ({
        textures: [...current.textures.filter((t) => t.path !== path), texture]
      }))
    } catch (err) {
      setError(toPayload(err))
    }
  }

  /**
   * A folder of pictures, filed by what they are called.
   *
   * The whole difficulty with a pack is not making the textures - it is knowing
   * where each one goes, and there are nearly four thousand places. A file
   * called `creeper.png` can only sensibly be one of them, so matching the name
   * against the real list does the filing and says plainly what it could not
   * place rather than guessing.
   */
  const fileThem = async (files: File[]): Promise<void> => {
    const known = new Set(vanilla)

    const byName = new Map<string, string[]>()

    for (const path of vanilla) {
      const leaf = path.slice(path.lastIndexOf('/') + 1)
      byName.set(leaf, [...(byName.get(leaf) ?? []), path])
    }

    const added: PackTexture[] = []
    const missed: string[] = []

    for (const file of files) {
      /*
       * The folder it came from settles what it is.
       *
       * Matching on the filename alone leaves 273 of them ambiguous - there
       * are twelve different textures called "saddle" and ten called
       * "diamond", and picking one would silently paint the wrong thing. When
       * a folder is imported the browser gives the path within it, so the
       * longest tail of that path which is a real texture is the answer, and
       * "block/stone" can no longer be confused with anything.
       */
      const relative = (file.webkitRelativePath || file.name).replace(/\.png$/i, '').toLowerCase()

      const parts = relative.split('/')
      let path: string | null = null

      for (let from = 0; from < parts.length; from++) {
        const tail = parts.slice(from).join('/')
        if (known.has(tail)) {
          path = tail
          break
        }
      }

      // No folder to go on: fall back to the name, and only when it is unique.
      if (path === null) {
        const found = byName.get(parts[parts.length - 1])
        if (found && found.length === 1) path = found[0]
      }

      if (path === null) {
        missed.push(file.name)
        continue
      }

      try {
        added.push({ path, image: await readPng(file) })
      } catch {
        missed.push(file.name)
      }
    }

    if (added.length > 0) {
      const paths = new Set(added.map((t) => t.path))
      mergeDraft((current) => ({
        textures: [...current.textures.filter((t) => !paths.has(t.path)), ...added]
      }))
    }

    setFiled({ took: added.length, missed })
  }

  /**
   * Writes the pack out as a file, wherever you want it.
   *
   * The one route that does not depend on this launcher staying open. Served
   * from here, the pack lives exactly as long as the app does - which is fine
   * while you are building it and no use at all once the server is somewhere
   * else. A file can go on any host, and then server.properties points at a
   * url that answers whether or not this machine is on.
   */
  const exportZip = async (): Promise<void> => {
    if (isEmpty(draft)) return

    try {
      const where = await api.app.pickSavePath({
        title: 'Save the resource pack',
        defaultName: `${draft.name.trim() || 'pack'}.zip`,
        extensions: ['zip']
      })

      if (!where) return

      setBusy(true)

      const made = await api.resourcePack.build(draft, packVersion, where)

      setBuilt(made)
      setUrl('')
      setOutcome(
        `Written to ${where}. Its SHA-1 is ${made.sha1} - a server needs that ` +
          'alongside the url, or every player downloads it again on every join.'
      )
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  /** Opens a .zip somebody already made, as far as this app understands it. */
  const openZip = async (): Promise<void> => {
    try {
      const picked = await api.app.pickFiles({
        title: 'Choose a resource pack',
        extensions: ['zip'],
        multi: false
      })

      if (picked.length === 0) return

      setWorking('opening')

      const read = await api.resourcePack.open(picked[0])

      setDraft({
        ...emptyDraft(),
        name: read.name,
        description: read.description,
        textures: read.textures,
        panorama: read.panorama,
        logo: read.logo
      })

      setPreview([])
      setFiled({ took: read.textures.length, missed: [] })

      if (read.ignored > 0) {
        // Said out loud rather than swallowed: a pack rebuilt without the parts
        // this app does not understand is a pack that quietly lost them.
        setError(
          toPayload(
            new Error(
              `Opened ${read.textures.length} textures. ${read.ignored} other files ` +
                '(models, sounds, fonts, shaders) are not understood here and would be ' +
                'lost if you rebuild from this.'
            )
          )
        )
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setWorking(null)
    }
  }

  /**
   * A whole pack from one style.
   *
   * Blocks, items and entities in one pass - about two and a half thousand
   * textures, which is a minute of work and the difference between a themed
   * pack and a themed folder.
   */
  const wholePack = async (): Promise<void> => {
    if (!style) return

    const paths = vanilla.filter(
      (path) => path.startsWith('block/') || path.startsWith('item/') || path.startsWith('entity/')
    )

    setWorking('everything')
    setError(null)
    setOutcome(null)
    setProgress({ done: 0, total: paths.length })

    const done: PackTexture[] = []

    try {
      for (const path of paths) {
        const original = await api.resourcePack.texture(packVersion, path)
        if (original) done.push({ path, image: await restyle(original, style) })

        if (done.length % 20 === 0) setProgress({ done: done.length, total: paths.length })
      }

      const touched = new Set(done.map((t) => t.path))

      mergeDraft((current) => ({
        name: style.name,
        description: style.name + ' — everything restyled',
        textures: [...current.textures.filter((t) => !touched.has(t.path)), ...done]
      }))

      setOutcome(
        `${done.length} textures restyled as ${style.name}. ` +
          'Blocks, items and entities. Save it before you close the launcher.'
      )
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setWorking(null)
      setProgress(null)
    }
  }

  /**
   * Keeps the whole draft, pixels and all.
   *
   * The alternative was storing the style and re-running it on reopen, which
   * halves the size and doubles the ways it can go wrong - a jar that has been
   * deleted, a version that has moved on, a preset that has changed since.
   * What is saved here is exactly what would have been built.
   */
  const keep = async (): Promise<void> => await keepUnder(openId)

  const keepUnder = async (id: string | null): Promise<void> => {
    if (isEmpty(draft)) return

    try {
      const kept = await api.creations.save({
        id,
        kind: 'resourcepack',
        name: draft.name.trim() || 'Resource pack',
        data: draft,
        // The first texture is a fair thumbnail and costs nothing to take.
        thumbnail: draft.textures[0]?.image ?? draft.items[0]?.image ?? null
      })

      setOpenId(kept.id)
      setSaved(await api.creations.list('resourcepack'))
    } catch (err) {
      setError(toPayload(err))
    }
  }

  /**
   * Back to an empty pack.
   *
   * The kept draft is overwritten rather than left alone: it is restored on
   * open whenever nothing is in hand, so clearing the screen without clearing
   * that would put all three thousand textures straight back the next time
   * this tab was opened, which is not what starting over means.
   *
   * Nothing saved is touched. This empties what is in front of you, and the
   * library keeps whatever was put in it.
   */
  const startOver = (): void => {
    setDraft(emptyDraft())
    setOpenId(null)
    setBuilt(null)
    setPreview([])
    setConfirming(null)

    void api.resourcePack.remember(emptyDraft()).catch(() => {
      /* A draft that will not clear is not worth interrupting somebody over. */
    })
  }

  const reopen = (entry: SavedCreation): void => {
    const body = entry.data as Partial<ResourcePackDraft> | null
    if (!body) return

    // Merged over a fresh draft, so a pack saved before a field existed opens
    // with that field empty rather than undefined.
    setDraft({ ...emptyDraft(), ...body })
    setOpenId(entry.id)
    setPreview([])
    setConfirming(null)
  }

  /** Keeps this as a new entry, leaving the one it was opened from alone. */
  const saveAsNew = async (): Promise<void> => await keepUnder(null)

  /**
   * A few textures with the style on them, side by side with the originals.
   *
   * Chosen to be things anybody recognises and that fail differently: stone is
   * flat grey, planks are warm and grainy, grass is saturated, a creeper is a
   * mob, and a sword is a thin shape on transparency where an outline goes
   * wrong most visibly.
   */
  const SAMPLES = [
    'block/stone',
    'block/oak_planks',
    'block/grass_block_side',
    'block/diamond_ore',
    'item/diamond_sword',
    'entity/creeper/creeper'
  ]

  const show = async (recipe: TextureRecipe): Promise<void> => {
    setWorking('previewing')

    try {
      const made: { path: string; before: string; after: string }[] = []

      for (const path of SAMPLES) {
        const before = await api.resourcePack.texture(packVersion, path)
        if (!before) continue

        made.push({ path, before, after: await restyle(before, recipe) })
      }

      setPreview(made)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setWorking(null)
    }
  }

  /**
   * Asks a model how a pack should feel, and gets numbers back.
   *
   * Not a picture - it cannot make one, and it cannot see the texture it is
   * restyling either. What it can do is choose the knobs: how far to turn the
   * colour, how much to drain it, what to wash over it. The code then applies
   * those to the real pixels, so every detail Mojang drew survives and only
   * its colour moves.
   */
  const dreamStyle = async (): Promise<void> => {
    if (!look.trim()) return

    setWorking('thinking')
    setError(null)

    try {
      const result = await api.banners.designRecipe(look.trim(), brain)

      setStyle(result.recipe)
      await show(result.recipe)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setWorking(null)
    }
  }

  /**
   * Applies the style to a whole folder of vanilla textures.
   *
   * Read from the jar rather than from anything on disk, so a restyle always
   * starts from what the game actually ships - restyling an already-restyled
   * texture twice over is how a pack ends up brown.
   */
  const restyleFolder = async (): Promise<void> => {
    if (!style) return

    const paths = vanilla.filter((path) => path.startsWith(folder + '/'))
    if (paths.length === 0) return

    setWorking('painting')
    setError(null)
    setOutcome(null)
    setProgress({ done: 0, total: paths.length })

    const done: PackTexture[] = []

    try {
      for (const path of paths) {
        const original = await api.resourcePack.texture(packVersion, path)
        if (original) done.push({ path, image: await restyle(original, style) })

        // Every twenty, not every one: repainting the screen three thousand
        // times is slower than the work it is describing.
        if (done.length % 20 === 0) setProgress({ done: done.length, total: paths.length })
      }

      const touched = new Set(done.map((t) => t.path))

      mergeDraft((current) => ({
        textures: [...current.textures.filter((t) => !touched.has(t.path)), ...done]
      }))

      setOutcome(`${done.length} ${folder} textures restyled as ${style.name}.`)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setWorking(null)
      setProgress(null)
    }
  }

  /** The same style, on one texture somebody picked. */
  const restyleOne = async (path: string): Promise<void> => {
    if (!style) return

    setWorking(path)

    try {
      const original = await api.resourcePack.texture(packVersion, path)
      if (!original) return

      const image = await restyle(original, style)

      mergeDraft((current) => ({
        textures: [...current.textures.filter((t) => t.path !== path), { path, image }]
      }))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setWorking(null)
    }
  }

  /**
   * Asks a model to describe a hat, and draws what it says.
   *
   * The model does not draw - it cannot. It answers with shapes on a sixty-four
   * square, the same vocabulary the icon maker uses, and the canvas turns that
   * into a texture. Asking a language model for pixels directly is what does
   * not work: it spends its whole budget counting to sixty-four and returns
   * either nothing or a grid of the wrong size.
   *
   * Drawn transparent, unlike an icon. A server icon wants its background
   * filled; a hat wants everything the shapes missed to be see-through, or it
   * arrives as a coloured square with a hat painted on it.
   */
  const dream = async (at: number, describe: string): Promise<void> => {
    const spec = COSMETIC_HATS[at]

    setThinking(spec.id)
    setError(null)

    try {
      const asked = describe.trim() || spec.label.toLowerCase() + ' hat'

      /*
       * Told what a hat is, not just what to call it.
       *
       * "A Minecraft hat texture: dragon egg" produced a gravestone with a
       * flag on it - the model was answering the noun and ignoring the hat.
       * Naming the silhouette it has to end up with, and forbidding the head
       * underneath, is what turns the description into headwear.
       *
       * The attempt number goes in so clicking again is a different answer
       * rather than the same one: the same prompt tends to come back the same.
       */
      const again = (tries[spec.id] ?? 0) + 1
      setTries({ ...tries, [spec.id]: again })

      const result = await api.banners.designIcon(
        'A hat, drawn flat as an item icon, seen from the side. ' +
          asked +
          '. It must read as headwear: a rounded crown or dome, with a brim, ' +
          'band or rim beneath it. Big simple shapes filling most of the square. ' +
          'No head, no person, no background, no border, no letters.' +
          (again > 1 ? ' Give a different design from before, attempt ' + again + '.' : ''),
        brain
      )

      const image = renderIconArt(result.art, { size: 64, transparent: true })

      if (!image) {
        setError(toPayload(new Error('nothing came back to draw')))
        return
      }

      const item: PackItem = {
        id: spec.id,
        label: spec.label + ' Hat',
        base: spec.base,
        image,
        replaces: false
      }

      mergeDraft((current) => ({ items: [...current.items.filter((i) => i.id !== spec.id), item] }))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setThinking(null)
    }
  }

  /** All eight, one after another rather than at once. */
  const dreamAll = async (): Promise<void> => {
    for (let at = 0; at < COSMETIC_HATS.length; at++) {
      // In order and one at a time: eight requests at once is how a local
      // Ollama ends up swapping, and the model is the slow part anyway.
      await dream(at, wish)
    }
  }

  /**
   * A picture for one of the server's cosmetic hats.
   *
   * The id is not the player's to choose: the plugin points every hat at
   * `nexus:hat_<name>` and looks for nothing else, so a texture named anything
   * approximate is a texture the game never finds. Filling it in here is the
   * whole point of the section - typing it by hand is one letter away from a
   * hat that silently stays a diamond block.
   */
  const setHatImage = async (at: number, file: File): Promise<void> => {
    try {
      const spec = COSMETIC_HATS[at]
      const image = await toSquarePng(file, 64)

      const item: PackItem = {
        id: spec.id,
        label: spec.label + ' Hat',
        base: spec.base,
        image,
        replaces: false
      }

      // Replaces whatever was already filed under that id, rather than adding
      // a second one the pack would then have two definitions for.
      mergeDraft((current) => ({ items: [...current.items.filter((i) => i.id !== spec.id), item] }))
    } catch (err) {
      setError(toPayload(err))
    }
  }

  useEffect(() => {
    void (async () => {
      const found: Target[] = []

      try {
        for (const server of await api.host.list()) {
          found.push({
            id: `server:${server.id}`,
            label: `${server.name} (server)`,
            kind: 'server',
            serverId: server.id,
            minecraftVersion: server.minecraftVersion
          })
        }
      } catch {
        /* Having no servers is not an error to report here. */
      }

      found.push({
        id: 'instance',
        label: `${instance.name} (just me)`,
        kind: 'instance',
        minecraftVersion: instance.minecraftVersion
      })

      setTargets(found)
      setTargetId((was) => (found.some((t) => t.id === was) ? was : (found[0]?.id ?? '')))

      try {
        setHost(await api.resourcePack.hostStatus())
      } catch {
        setHost(null)
      }

      try {
        setSaved(await api.creations.list('resourcepack'))
      } catch {
        setSaved([])
      }

      /*
       * Whatever was being worked on last time.
       *
       * Only when there is nothing in hand, so opening this tab never throws
       * away a pack that is already on screen - and merged over a fresh draft
       * so a pack kept before a field existed comes back with that field empty
       * rather than missing.
       */
      try {
        const last = await api.resourcePack.recall()
        if (last && isEmpty(draft)) setDraft({ ...emptyDraft(), ...last })
      } catch {
        /* Nothing kept is the ordinary case on a first run. */
      }

      try {
        /*
         * Only the ones that can answer.
         *
         * The other generators already filter this way. Here an unconfigured
         * model stayed in the list and failed at the moment of asking, which
         * looks like the feature is broken rather than unfinished.
         */
        const found = (await api.banners.brains()).filter((b) => b.ready)
        setBrains(found.map((b) => ({ id: b.id, label: b.label })))
        setBrain((was) => (found.some((b) => b.id === was) ? was : (found[0]?.id ?? '')))
      } catch {
        setBrains([])
      }
    })()
  }, [instance.name])

  const target = targets.find((t) => t.id === targetId) ?? null

  /** The version whose textures are read and whose format is written. */
  const packVersion = target?.minecraftVersion ?? instance.minecraftVersion

  /*
   * Re-read when the target changes, because switching from a server to "just
   * me" can move between two entirely different sets of textures.
   */
  useEffect(() => {
    void (async () => {
      try {
        setVanilla(await api.resourcePack.textures(packVersion))
      } catch {
        setVanilla([])
      }
    })()
  }, [packVersion])

  /* ------------------------------------------------------------- items -- */

  const addItem = async (file: File): Promise<void> => {
    try {
      const label = file.name.replace(/\.[^.]+$/, '')

      const item: PackItem = {
        id: safeId(label),
        label,
        base: 'minecraft:stick',
        image: await toSquarePng(file, 16),
        replaces: false
      }

      mergeDraft((current) => ({ items: [...current.items, item] }))
    } catch (err) {
      setError(toPayload(err))
    }
  }

  const changeItem = (at: number, next: Partial<PackItem>): void => {
    setDraft({ items: draft.items.map((item, i) => (i === at ? { ...item, ...next } : item)) })
  }

  /*
   * Items that are not hats, carrying the index they came from.
   *
   * A hat is stored as an item, so all eight of them were listed on the Items
   * tab beside anything else - and not harmlessly. That row renames the id
   * from the label as you type, and the plugin looks for `hat_dragon_egg`
   * exactly; the base dropdown offers a fixed list that a dragon egg is not
   * on, so a hat showed "stick" and would have become one on a stray click.
   *
   * The index is carried because the row edits and deletes by position in the
   * real array, and filtering a list you then index into is how you delete the
   * wrong thing.
   */
  const plainItems = draft.items.map((item, at) => ({ item, at })).filter(({ item }) => !HAT_IDS.has(item.id))

  /* ------------------------------------------------------------ sounds -- */

  /**
   * Adds audio in whatever format it arrives in.
   *
   * Read through a file input rather than the native picker, because the
   * conversion needs the bytes and the renderer cannot open a path off disk.
   * Whatever comes out the far end is Ogg Vorbis in a folder the launcher
   * owns, so a saved pack no longer breaks when the original is moved or
   * tidied away - which the builder had an error for and no answer to.
   */
  const addSounds = async (files: File[]): Promise<void> => {
    const added: PackSound[] = []

    for (const file of files) {
      const label = file.name.replace(/\.[^.]+$/, '') || 'sound'

      try {
        setConverting({ name: file.name, done: 0 })

        const result = await toOggVorbis(file, (done) => setConverting({ name: file.name, done }))

        /*
         * To base64 in blocks. Spreading a four megabyte array into
         * String.fromCharCode at once overflows the argument limit and throws
         * a RangeError that says nothing about audio.
         */
        const raw = new Uint8Array(result.bytes)
        let binary = ''
        for (let at = 0; at < raw.length; at += 8192) {
          binary += String.fromCharCode(...raw.subarray(at, at + 8192))
        }

        const kept = await api.resourcePack.saveSound(label, btoa(binary))

        added.push({
          id: safeId(label),
          label,
          event: 'music_disc.cat',
          file: kept.path,
          stream: true
        })
      } catch (err) {
        setError(toPayload(err))
      } finally {
        setConverting(null)
      }
    }

    // Once, so adding several does not drop all but the last.
    if (added.length > 0) mergeDraft((current) => ({ sounds: [...current.sounds, ...added] }))
  }

  const changeSound = (at: number, next: Partial<PackSound>): void => {
    setDraft({ sounds: draft.sounds.map((s, i) => (i === at ? { ...s, ...next } : s)) })
  }

  /* -------------------------------------------------------------- menu -- */

  const setFaceImage = async (at: number, file: File): Promise<void> => {
    try {
      const image = await toSquarePng(file, 1024)
      const faces = draft.panorama ? [...draft.panorama] : new Array(6).fill(image)

      faces[at] = image
      setDraft({ panorama: faces })
    } catch (err) {
      setError(toPayload(err))
    }
  }

  /* ------------------------------------------------------------ armour -- */

  /**
   * Builds a set from a vanilla one and the chosen look.
   *
   * Recoloured rather than drawn. The worn layer is not a picture of armour -
   * it is an unwrap of the player model, and every pixel of it lands somewhere
   * specific on a body - so asking a model to invent one produces a smear.
   * Running Mojang's own layer through the same recipe the textures use keeps
   * every seam where it belongs and still comes out a different set of armour.
   */
  const forgeArmour = async (): Promise<void> => {
    if (!style) return

    const base = ARMOUR_BASES.find((b) => b.id === armourBase)
    if (!base) return

    const label = armourName.trim() || `${style.name} ${base.label}`
    const id = safeId(label)

    if (!id) {
      setError(toPayload(new Error('That name has no letters or numbers in it, so it cannot be an id.')))
      return
    }

    setForging(true)
    setError(null)

    try {
      const dress = async (path: string): Promise<string | null> => {
        const original = await api.resourcePack.texture(packVersion, path)
        return original ? await restyle(original, style) : null
      }

      const body = await dress(`entity/equipment/humanoid/${base.asset}`)
      const legs = await dress(`entity/equipment/humanoid_leggings/${base.asset}`)

      if (!body || !legs) {
        throw new Error(`${base.label} armour has no worn texture in ${packVersion}, so a set cannot be built on it.`)
      }

      const icons: PackArmour['icons'] = {
        helmet: '',
        chestplate: '',
        leggings: '',
        boots: ''
      }

      for (const piece of ARMOUR_PIECES) {
        const drawn = await dress(`item/${base.item}_${piece.id}`)
        if (!drawn) throw new Error(`${base.label} has no ${piece.label} icon in ${packVersion}.`)
        icons[piece.id] = drawn
      }

      const set: PackArmour = { id, label, base: base.item, body, legs, icons }

      mergeDraft((current) => ({
        armour: [...current.armour.filter((a) => a.id !== id), set]
      }))

      setArmourName('')
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setForging(false)
    }
  }

  /* ------------------------------------------------------------- build -- */

  const install = async (): Promise<void> => {
    if (!target) return

    setBusy(true)
    setError(null)

    try {
      if (target.kind === 'instance') {
        setBuilt(await api.resourcePack.install(instance.id, draft))
        setUrl('')
      } else {
        const chosen =
          reachFor === 'typed'
            ? address.trim() || undefined
            : reachFor === 'house'
              ? (host?.localAddress ?? undefined)
              : undefined

        const result = await api.resourcePack.serve(target.serverId as string, draft, port, required, chosen)

        setBuilt(result)
        setUrl(result.url)
        setReach({ ok: result.reachable, alternative: result.alternative })
        setHost(await api.resourcePack.hostStatus())
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  /*
   * The pack port is not the game port and has to be forwarded separately.
   *
   * Without this the pack url resolves to an address nobody outside the house
   * can reach, and the client shows a download stuck at nought per cent rather
   * than anything that says why.
   */
  const checkPort = async (): Promise<void> => {
    setAsking(true)
    try {
      setForwarding(await api.resourcePack.portStatus(port))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setAsking(false)
    }
  }

  const openThePort = async (): Promise<void> => {
    setAsking(true)
    try {
      setForwarding(await api.resourcePack.openPort(port))
      if (!address.trim()) {
        const status = await api.resourcePack.portStatus(port)
        if (status.externalAddress) setAddress(status.externalAddress)
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setAsking(false)
    }
  }

  const closeThePort = async (): Promise<void> => {
    setAsking(true)
    try {
      setForwarding(await api.resourcePack.closePort(port))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setAsking(false)
    }
  }

  const stopServing = async (): Promise<void> => {
    try {
      setHost(await api.resourcePack.stopHost())
      if (target?.kind === 'server') await api.resourcePack.detach(target.serverId as string)
      setUrl('')
    } catch (err) {
      setError(toPayload(err))
    }
  }

  const nothing = isEmpty(draft)

  /*
   * Errors are reported at the top and acted on at the bottom.
   *
   * The build button used to sit nineteen hundred lines down a single column,
   * so a refused build put a red panel somewhere off-screen and the button
   * appeared to do nothing at all. That is exactly what a rejected payload
   * looked like for as long as the cap was wrong.
   */
  useEffect(() => {
    if (error) top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [error])

  return (
    <div className="col gap-16">
      <div ref={top}>{error && <ErrorView error={error} onDismiss={() => setError(null)} />}</div>

      <div className="panel panel-pad col gap-12">
        <div className="section-title">The pack</div>

        <div className="row gap-8 wrap">
          <input
            className="input"
            style={{ flex: '1 1 180px' }}
            value={draft.name}
            placeholder="Name"
            onChange={(e) => setDraft({ name: e.target.value.slice(0, 64) })}
          />
          <input
            className="input"
            style={{ flex: '2 1 260px' }}
            value={draft.description}
            placeholder="What it is, shown in the pack list"
            onChange={(e) => setDraft({ description: e.target.value.slice(0, 256) })}
          />
        </div>

        <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
          <button className="btn btn-sm" disabled={nothing} onClick={() => void keep()}>
            <Save size={14} /> {openId ? 'Save changes' : 'Save this pack'}
          </button>

          {openId && (
            <button className="btn btn-sm" disabled={nothing} onClick={() => void saveAsNew()}>
              Save as a copy
            </button>
          )}

          <button
            className="btn btn-sm"
            disabled={nothing}
            title="Empty this pack and begin again. Nothing saved is touched."
            onClick={() => (confirming === 'pack' ? startOver() : setConfirming('pack'))}
            style={confirming === 'pack' ? { color: 'var(--danger)' } : undefined}
          >
            {confirming === 'pack' ? 'Empty it — sure?' : 'Start over'}
          </button>

          <span className="tiny dim">
            {nothing
              ? 'Nothing in it yet.'
              : openId
                ? 'Saving writes over the one you opened. Kept as you work as well.'
                : 'Kept as you work as well, so closing the launcher does not lose it.'}
          </span>
        </div>

        {keepFailed && (
          <p className="small" style={{ color: 'var(--warning)', margin: 0 }}>
            Not being kept as you work &mdash; {keepFailed}. Save it by hand on the Saved tab before you close the
            launcher.
          </p>
        )}
      </div>

      {/*
       * The jobs, not the panels.
       *
       * Nine sections in one column meant scrolling past the hats every time
       * to reach the button that builds the thing. The pack's name stays put
       * above, because it belongs to all of them; the counts ride on the tabs
       * so that what is in the six you cannot see is still visible.
       */}
      <div className="tab-strip">
        {PACK_TABS.map((entry) => {
          const count = countFor(entry.id, draft)

          return (
            <button
              key={entry.id}
              className={`tab ${tab === entry.id ? 'active' : ''}`}
              onClick={() => setTab(entry.id)}
            >
              <entry.icon size={14} />
              {entry.label}
              {count > 0 && <span className="tab-count">{count}</span>}
            </button>
          )
        })}
      </div>

      {tab === 'textures' && (
        <div className="panel panel-pad col gap-12">
          <div className="row gap-8" style={{ alignItems: 'center' }}>
            <div className="section-title" style={{ flex: 1 }}>
              Replace any texture
            </div>
            <button className="btn btn-sm" onClick={() => folderPick.current?.click()}>
              <Upload size={14} /> Import a folder
            </button>
            <button className="btn btn-sm" onClick={() => bulkPick.current?.click()}>
              Pick files
            </button>
            <button className="btn btn-sm" disabled={working !== null} onClick={() => void openZip()}>
              {working === 'opening' && <Spinner />} Open a .zip
            </button>
          </div>

          {/*
            This used to end "your Desktop has the whole lot already, edit
            those in place and import the folder back", which read as a first
            step and is not one. Restyling already reads the jar; importing the
            unedited folder on top of it just fills the pack with three
            thousand copies of vanilla, and that folder is a different version
            of the game besides.
          */}
          <p className="small muted">
            Everything the game draws &mdash; {vanilla.length.toLocaleString()} textures in {packVersion}: blocks,
            items, mobs, particles, paintings, menus. Restyling reads these straight out of the game&apos;s own files,
            so there is nothing to import first. Search for one to change by hand, or import a folder only to bring back
            PNGs you have edited yourself &mdash; importing unedited copies adds textures identical to the ones already
            in the game, which changes nothing.
          </p>

          <input
            className="input"
            value={hunt}
            placeholder="search, eg creeper, stone, diamond_sword, wither"
            onChange={(e) => setHunt(e.target.value)}
          />

          {hunt.trim().length >= 2 && (
            <div className="col gap-4" style={{ maxHeight: 240, overflowY: 'auto' }}>
              {vanilla
                .filter((path) => path.includes(hunt.trim().toLowerCase()))
                .slice(0, 60)
                .map((path) => {
                  const done = draft.textures.find((t) => t.path === path)

                  return (
                    <div key={path} className="row gap-8" style={{ alignItems: 'center' }}>
                      {done && (
                        <img
                          src={done.image}
                          alt=""
                          width={20}
                          height={20}
                          style={{ imageRendering: 'pixelated', borderRadius: 3 }}
                        />
                      )}
                      <code className="tiny" style={{ flex: 1, wordBreak: 'break-all' }}>
                        {path}
                      </code>
                      {style && (
                        <button
                          className="btn btn-sm"
                          disabled={working !== null}
                          onClick={() => void restyleOne(path)}
                          title={`Apply ${style.name} to this one`}
                        >
                          {style.name}
                        </button>
                      )}
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          setAiming(path)
                          texPick.current?.click()
                        }}
                      >
                        {done ? 'Change' : 'Replace'}
                      </button>
                    </div>
                  )
                })}
            </div>
          )}

          {/* ------------------------------------------------------- restyling */}

          <div className="col gap-8">
            <div className="section-title">Restyle them</div>

            <p className="small muted">
              Keeps every detail Mojang drew and moves only the colour, so a whole folder restyled the same way still
              looks like Minecraft. Pick a look, or describe one.
            </p>

            <div className="row gap-6 wrap">
              {RECIPE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  className={`btn btn-sm${style?.name === preset.name ? ' btn-primary' : ''}`}
                  onClick={() => {
                    setStyle(preset)
                    void show(preset)
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            {brains.length > 0 && (
              <div className="row gap-8 wrap">
                <input
                  className="input"
                  style={{ flex: '1 1 220px' }}
                  value={look}
                  placeholder="or describe one, eg drowned and waterlogged, volcanic, candy"
                  onChange={(e) => setLook(e.target.value.slice(0, 200))}
                />
                <button
                  className="btn btn-sm"
                  disabled={working !== null || !look.trim()}
                  onClick={() => void dreamStyle()}
                >
                  {working === 'thinking' && <Spinner />} Ask {brains.find((b) => b.id === brain)?.label ?? 'the AI'}
                </button>
              </div>
            )}

            {progress && (
              <div className="col gap-4">
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--line, #2a2a33)',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                      background: 'var(--accent, #5ad1c0)',
                      transition: 'width .2s linear'
                    }}
                  />
                </div>
                <span className="tiny dim">
                  {progress.done.toLocaleString()} of {progress.total.toLocaleString()} &mdash; this runs in the app, so
                  leave the tab open
                </span>
              </div>
            )}

            {outcome && !progress && (
              <p className="small" style={{ color: 'var(--success, #55d18b)' }}>
                {outcome}
              </p>
            )}

            {preview.length > 0 && (
              <div className="row gap-10 wrap">
                {preview.map((sample) => (
                  <div key={sample.path} className="col gap-4" style={{ width: 76 }}>
                    <div className="row gap-2" style={{ alignItems: 'center' }}>
                      <img
                        src={sample.before}
                        alt="before"
                        style={{
                          width: 34,
                          height: 34,
                          imageRendering: 'pixelated',
                          borderRadius: 3,
                          opacity: 0.55
                        }}
                      />
                      <img
                        src={sample.after}
                        alt="after"
                        style={{
                          width: 34,
                          height: 34,
                          imageRendering: 'pixelated',
                          borderRadius: 3
                        }}
                      />
                    </div>
                    <span className="tiny dim truncate">{sample.path.slice(sample.path.lastIndexOf('/') + 1)}</span>
                  </div>
                ))}
              </div>
            )}

            {style && (
              <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                <span className="small">
                  <strong>{style.name}</strong>
                </span>

                <select
                  className="select"
                  style={{ width: 130 }}
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                >
                  {['block', 'item', 'entity', 'particle', 'painting', 'gui'].map((f) => (
                    <option key={f} value={f}>
                      {f} ({vanilla.filter((p) => p.startsWith(f + '/')).length})
                    </option>
                  ))}
                </select>

                <button
                  className="btn btn-primary btn-sm"
                  disabled={working !== null}
                  onClick={() => void restyleFolder()}
                >
                  {working === 'painting' && <Spinner />} Restyle every {folder}
                </button>

                <button className="btn btn-primary btn-sm" disabled={working !== null} onClick={() => void wholePack()}>
                  {working === 'everything' && <Spinner />} Restyle everything
                </button>

                <button className="btn btn-sm" onClick={() => setStyle(null)}>
                  Clear
                </button>
              </div>
            )}

            {style && (
              <p className="tiny dim">
                &quot;Restyle everything&quot; does blocks, items and entities in one go &mdash;{' '}
                {
                  vanilla.filter((p) => p.startsWith('block/') || p.startsWith('item/') || p.startsWith('entity/'))
                    .length
                }{' '}
                textures, which takes a minute. Every one is read from the game&apos;s own jar first, so restyling twice
                does not stack &mdash; you always start from the original. A whole folder takes a moment;{' '}
                {vanilla.filter((p) => p.startsWith(folder + '/')).length} textures is a lot of pixels.
              </p>
            )}
          </div>

          {draft.textures.length > 0 && (
            <>
              <div className="row gap-8" style={{ alignItems: 'center' }}>
                <div className="section-title" style={{ flex: 1 }}>
                  Replaced &middot; {draft.textures.length.toLocaleString()}
                </div>

                <button
                  className="btn btn-sm"
                  title="Put every one of these back to how Mojang drew it"
                  onClick={() =>
                    confirming === 'textures'
                      ? (setDraft({ textures: [] }), setConfirming(null))
                      : setConfirming('textures')
                  }
                  style={confirming === 'textures' ? { color: 'var(--danger)' } : undefined}
                >
                  {confirming === 'textures'
                    ? `Remove all ${draft.textures.length.toLocaleString()} — sure?`
                    : 'Remove all'}
                </button>
              </div>
              <TextureList textures={draft.textures} onRemove={removeTexture} />
            </>
          )}

          {filed && (
            <p className="tiny dim">
              Filed {filed.took} of {filed.took + filed.missed.length}.
              {filed.missed.length > 0 && (
                <>
                  {' '}
                  Could not place: {filed.missed.slice(0, 6).join(', ')}
                  {filed.missed.length > 6 ? ` and ${filed.missed.length - 6} more` : ''}. Name a file after the texture
                  it replaces &mdash; search above to find the name.
                </>
              )}
            </p>
          )}

          <input
            ref={texPick}
            type="file"
            accept="image/png"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file && aiming) void swap(aiming, file)
              e.target.value = ''
            }}
          />

          {/*
           * A directory picker, which is not standard HTML but is what makes
           * the folder shape available - and the folder shape is what tells a
           * "saddle" from the eleven other saddles.
           */}
          <input
            ref={folderPick}
            type="file"
            accept="image/png"
            multiple
            hidden
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error - webkitdirectory is not in the React typings
            webkitdirectory=""
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).filter((f) => f.name.toLowerCase().endsWith('.png'))
              if (files.length > 0) void fileThem(files)
              e.target.value = ''
            }}
          />

          <input
            ref={bulkPick}
            type="file"
            accept="image/png"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) void fileThem(files)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {tab === 'items' && (
        <div className="panel panel-pad col gap-12">
          <div className="row gap-8" style={{ alignItems: 'center' }}>
            <div className="section-title" style={{ flex: 1 }}>
              Item textures
            </div>
            <button className="btn btn-sm" onClick={() => itemPick.current?.click()}>
              <Plus size={14} /> Add a picture
            </button>
            <input
              ref={itemPick}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                for (const file of Array.from(e.target.files ?? [])) void addItem(file)
                e.target.value = ''
              }}
            />
          </div>

          {plainItems.length === 0 ? (
            <p className="small muted">
              Drop in any picture and it becomes a 16 by 16 item texture. By default it is a new look the item points
              at, so ordinary sticks are left alone — which is what pairs with the custom items you already make in
              Generators.
            </p>
          ) : (
            <div className="col gap-8">
              {plainItems.map(({ item, at }) => (
                <div key={item.id} className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                  <img
                    src={item.image}
                    alt={item.label}
                    width={36}
                    height={36}
                    style={{ imageRendering: 'pixelated', borderRadius: 4 }}
                  />

                  <input
                    className="input"
                    style={{ flex: '1 1 150px' }}
                    value={item.label}
                    onChange={(e) => changeItem(at, { label: e.target.value, id: safeId(e.target.value) })}
                  />

                  <select
                    className="select"
                    style={{ flex: '1 1 150px' }}
                    value={item.base}
                    onChange={(e) => changeItem(at, { base: e.target.value })}
                  >
                    {BASE_ITEMS.map((id) => (
                      <option key={id} value={id}>
                        {id.replace('minecraft:', '').replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>

                  <label className="row gap-4 tiny" style={{ alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={item.replaces}
                      onChange={(e) => changeItem(at, { replaces: e.target.checked })}
                    />
                    Replace every one
                  </label>

                  <button
                    className="btn btn-sm"
                    title="Take it out"
                    onClick={() => setDraft({ items: draft.items.filter((_, i) => i !== at) })}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}

              <p className="tiny dim">
                &quot;Replace every one&quot; takes over the vanilla texture, so every stick in the world changes. Left
                off, only items given with the command below look different.
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'hats' && (
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Cosmetic hats</div>

          <p className="small muted">
            The eight hats the server sells. Drop a picture on each and it becomes that hat&apos;s real look instead of
            a block balanced on somebody&apos;s head. The names are filled in for you &mdash; the plugin looks for these
            exact ones.
          </p>

          <div className="row gap-8 wrap">
            {COSMETIC_HATS.map((spec, at) => {
              const done = draft.items.find((i) => i.id === spec.id)

              return (
                <button
                  key={spec.id}
                  className="btn btn-ghost col gap-4"
                  style={{ padding: 5, height: 'auto', width: 84 }}
                  title={`Picture for the ${spec.label} hat`}
                  onClick={() => {
                    if (brains.length > 0 && wish.trim()) {
                      void dream(at, wish)
                      return
                    }

                    setHat(at)
                    hatPick.current?.click()
                  }}
                >
                  {done ? (
                    <img
                      src={done.image}
                      alt={spec.label}
                      style={{
                        width: '100%',
                        borderRadius: 4,
                        display: 'block',
                        imageRendering: 'pixelated'
                      }}
                    />
                  ) : (
                    <div className="row" style={{ height: 48, alignItems: 'center', justifyContent: 'center' }}>
                      <Plus size={16} className="dim" />
                    </div>
                  )}
                  <span className="tiny dim">{spec.label}</span>
                </button>
              )
            })}
          </div>

          <input
            ref={hatPick}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void setHatImage(hat, file)
              e.target.value = ''
            }}
          />

          {brains.length > 0 && (
            <div className="col gap-8">
              <div className="section-title">Or describe them</div>

              <div className="row gap-8 wrap">
                <select
                  className="select"
                  style={{ width: 150 }}
                  value={brain}
                  onChange={(e) => setBrain(e.target.value)}
                >
                  {brains.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>

                <input
                  className="input"
                  style={{ flex: '1 1 220px' }}
                  value={wish}
                  placeholder="a style for all of them, eg neon, medieval, cursed"
                  onChange={(e) => setWish(e.target.value.slice(0, 200))}
                />

                <button className="btn btn-primary btn-sm" disabled={thinking !== null} onClick={() => void dreamAll()}>
                  {thinking !== null && <Spinner />} Draw all eight
                </button>
              </div>

              <div className="row gap-6 wrap">
                {HAT_STYLES.map((idea) => (
                  <button key={idea} className="btn btn-sm" style={{ fontSize: 12 }} onClick={() => setWish(idea)}>
                    {idea}
                  </button>
                ))}
              </div>

              <p className="tiny dim">
                The model describes shapes and the app draws them &mdash; it cannot paint pixels directly, so bold
                simple hats come out well and fiddly ones do not.{' '}
                <strong>Click any hat again to re-roll just that one</strong> &mdash; each try asks for something
                different. If a hat will not come out right, draw it yourself and drop the file on it instead.
              </p>
            </div>
          )}

          <p className="tiny dim">
            Once the pack is on the server, set <code>cosmetics.customModels: true</code> in the plugin config and
            restart. It is off by default because a pack with some hats and not others shows the missing texture for the
            rest.
          </p>
        </div>
      )}

      {tab === 'armour' && (
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Custom armour</div>

          <p className="small muted">
            A set is real armour wearing different pictures &mdash; same protection and durability as whatever you build
            it on, so nothing is unbalanced by it. Recoloured from Mojang&apos;s own layers rather than drawn from
            nothing: the worn texture is an unwrap of the player model, and inventing one produces a smear rather than
            armour.
          </p>

          {!style ? (
            <p className="small" style={{ color: 'var(--warning)' }}>
              Pick a look on the Textures tab first &mdash; that is what the set is coloured with.
            </p>
          ) : (
            <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 140 }}>
                <label className="field-label">Built on</label>
                <select className="select" value={armourBase} onChange={(e) => setArmourBase(e.target.value)}>
                  {ARMOUR_BASES.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field" style={{ flex: '1 1 180px' }}>
                <label className="field-label">Called</label>
                <input
                  className="input"
                  value={armourName}
                  placeholder={`${style.name} ${ARMOUR_BASES.find((b) => b.id === armourBase)?.label ?? ''}`}
                  onChange={(e) => setArmourName(e.target.value.slice(0, 48))}
                />
              </div>

              <button className="btn btn-primary btn-sm" disabled={forging} onClick={() => void forgeArmour()}>
                {forging && <Spinner />} Make the set
              </button>
            </div>
          )}

          {draft.armour.length > 0 && (
            <div className="col gap-10">
              {draft.armour.map((set) => (
                <div key={set.id} className="col gap-6">
                  <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                    {ARMOUR_PIECES.map((piece) => (
                      <img
                        key={piece.id}
                        src={set.icons[piece.id]}
                        alt={piece.label}
                        width={32}
                        height={32}
                        title={piece.label}
                        style={{ imageRendering: 'pixelated', borderRadius: 4 }}
                      />
                    ))}

                    <span className="small" style={{ flex: '1 1 120px' }}>
                      <strong>{set.label}</strong>
                      <span className="dim"> &middot; worn as {set.base}</span>
                    </span>

                    <button
                      className="btn btn-sm"
                      title="Take it out"
                      onClick={() =>
                        mergeDraft((current) => ({
                          armour: current.armour.filter((a) => a.id !== set.id)
                        }))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <div className="row gap-8 wrap">
                    <img
                      src={set.body}
                      alt="worn layer"
                      title="The layer drawn on the body"
                      style={{ height: 48, imageRendering: 'pixelated', borderRadius: 4 }}
                    />
                    <img
                      src={set.legs}
                      alt="legs layer"
                      title="The layer drawn on the legs"
                      style={{ height: 48, imageRendering: 'pixelated', borderRadius: 4 }}
                    />
                  </div>

                  <textarea
                    className="input mono"
                    rows={4}
                    readOnly
                    value={ARMOUR_PIECES.map((piece) => giveArmour(set, piece, 'nexus')).join('\n')}
                  />
                </div>
              ))}

              <p className="tiny dim">
                Sent straight through the server console, so it lands in their inventory while they are playing. A
                player without the pack is given ordinary armour and sees ordinary armour, so nothing breaks for them
                &mdash; but the pack has to be built and served before it looks like anything.
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'sounds' && (
        <div className="panel panel-pad col gap-12">
          <div className="row gap-8" style={{ alignItems: 'center' }}>
            <div className="section-title" style={{ flex: 1 }}>
              Sounds and music discs
            </div>
            <button className="btn btn-sm" disabled={converting !== null} onClick={() => soundPick.current?.click()}>
              {converting ? <Spinner /> : <Music size={14} />} Add a sound
            </button>

            <input
              ref={soundPick}
              type="file"
              accept="audio/*,.ogg,.mp3,.wav,.flac,.m4a,.aac,.opus"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length > 0) void addSounds(files)
                e.target.value = ''
              }}
            />
          </div>

          {converting && (
            <div className="col gap-4">
              <div className="row gap-8 between">
                <span className="tiny dim truncate">Converting {converting.name}</span>
                <span className="tiny dim">{Math.round(converting.done * 100)}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--panel-flat)' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round(converting.done * 100)}%`,
                    borderRadius: 3,
                    background: 'var(--accent)',
                    transition: 'width 0.2s'
                  }}
                />
              </div>
            </div>
          )}

          {draft.sounds.length === 0 ? (
            <p className="small muted">
              Pick a sound the game already plays and put your own audio under it. Drop in an mp3, a wav, a flac or an
              m4a and it is converted here — Ogg Vorbis is the only thing Minecraft plays, and even an .ogg holding Opus
              is silent in game, so those are re-encoded too.
            </p>
          ) : (
            <div className="col gap-8">
              {draft.sounds.map((sound, at) => (
                <div key={at} className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                  <input
                    className="input"
                    style={{ flex: '1 1 140px' }}
                    value={sound.label}
                    onChange={(e) => changeSound(at, { label: e.target.value, id: safeId(e.target.value) })}
                  />

                  <select
                    className="select"
                    style={{ flex: '1 1 200px' }}
                    value={sound.event}
                    onChange={(e) => {
                      const known = SOUND_EVENTS.find((s) => s.event === e.target.value)
                      changeSound(at, {
                        event: e.target.value,
                        stream: known ? known.stream : true
                      })
                    }}
                  >
                    <optgroup label="Music discs">
                      {MUSIC_DISCS.map((disc) => (
                        <option key={disc.event} value={disc.event}>
                          {disc.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Everything else">
                      {SOUND_EVENTS.map((entry) => (
                        <option key={entry.event} value={entry.event}>
                          {entry.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>

                  <span className="tiny dim truncate" style={{ flex: '1 1 120px' }}>
                    {sound.file.split(/[\\/]/).pop()}
                  </span>

                  <button
                    className="btn btn-sm"
                    title="Take it out"
                    onClick={() => setDraft({ sounds: draft.sounds.filter((_, i) => i !== at) })}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'menu' && (
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Main menu</div>

          <p className="small muted">
            The title screen background is a cube of six pictures the camera sits inside. Set one and the rest are
            filled with it, so a single image works — set them face by face for a real panorama.
          </p>

          {/*
           * The one thing here that cannot be worked out by trying it.
           *
           * A server's pack is applied on connecting and dropped on leaving, and
           * the title screen is neither - so somebody sets a panorama, serves
           * it, joins, and never sees it, with nothing anywhere to say why.
           */}
          {target?.kind === 'server' && (draft.panorama || draft.logo) && (
            <p className="small" style={{ color: 'var(--warning)' }}>
              These will not show while the pack comes from a server. Minecraft applies a server&apos;s pack when you
              connect and drops it when you leave, and the title screen is neither — so a menu background can only come
              from a pack installed on your own machine. Build it again with &quot;(just me)&quot; and turn it on under
              Options, Resource Packs.
            </p>
          )}

          <div className="row gap-8 wrap">
            {PANORAMA_FACES.map((name, at) => (
              <button
                key={name}
                className="btn btn-ghost col gap-4"
                style={{ padding: 4, height: 'auto', width: 92 }}
                title={`Set the ${name.toLowerCase()} face`}
                onClick={() => {
                  setFace(at)
                  facePick.current?.click()
                }}
              >
                {draft.panorama?.[at] ? (
                  <img
                    src={draft.panorama[at]}
                    alt={name}
                    style={{ width: '100%', borderRadius: 4, display: 'block' }}
                  />
                ) : (
                  <div className="row" style={{ height: 52, alignItems: 'center', justifyContent: 'center' }}>
                    <ImageIcon size={18} className="dim" />
                  </div>
                )}
                <span className="tiny dim">{name}</span>
              </button>
            ))}
          </div>

          <input
            ref={facePick}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void setFaceImage(face, file)
              e.target.value = ''
            }}
          />

          <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
            <button className="btn btn-sm" onClick={() => logoPick.current?.click()}>
              <Upload size={14} /> {draft.logo ? 'Change the logo' : 'Custom title logo'}
            </button>

            {draft.logo && (
              <>
                <img src={draft.logo} alt="logo" style={{ height: 30, borderRadius: 4, imageRendering: 'pixelated' }} />
                <button className="btn btn-sm" onClick={() => setDraft({ logo: null })}>
                  <Trash2 size={13} />
                </button>
              </>
            )}

            {draft.panorama && (
              <button className="btn btn-sm" onClick={() => setDraft({ panorama: null })}>
                Clear the background
              </button>
            )}

            <input
              ref={logoPick}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readPng(file).then((logo) => setDraft({ logo }))
                e.target.value = ''
              }}
            />
          </div>
        </div>
      )}

      {tab === 'saved' && (
        <div className="panel panel-pad col gap-12">
          <div className="row gap-8" style={{ alignItems: 'center' }}>
            <div className="section-title" style={{ flex: 1 }}>
              Keep it
            </div>
            <button className="btn btn-primary btn-sm" disabled={isEmpty(draft)} onClick={() => void keep()}>
              {openId ? 'Save changes' : 'Save this pack'}
            </button>
          </div>

          <p className="small muted">
            Saved as it is, textures and all, so you can come back to it or build a variant without starting again.
            Until you save, a pack only lives while the launcher is open.
          </p>

          {saved.length > 0 && (
            <div className="row gap-10 wrap">
              {saved.map((entry) => (
                <div key={entry.id} className="col gap-6" style={{ width: 128 }}>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: 4, height: 'auto' }}
                    title="Open this one"
                    onClick={() => reopen(entry)}
                  >
                    {entry.thumbnail ? (
                      <img
                        src={entry.thumbnail}
                        alt={entry.name}
                        style={{
                          width: '100%',
                          borderRadius: 5,
                          display: 'block',
                          imageRendering: 'pixelated'
                        }}
                      />
                    ) : (
                      <span className="tiny">{entry.name}</span>
                    )}
                  </button>

                  <div className="row gap-6" style={{ alignItems: 'center' }}>
                    <span className="tiny dim truncate" style={{ flex: 1 }}>
                      {entry.name}
                    </span>
                    <button
                      className="btn btn-sm"
                      title="Forget it"
                      onClick={() => {
                        void (async () => {
                          await api.creations.remove(entry.id)
                          setSaved(await api.creations.list('resourcepack'))
                        })()
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'build' && (
        <>
          <div className="panel panel-pad col gap-12">
            <div className="section-title">Put it somewhere</div>

            <div className="row gap-8 wrap" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 220px' }}>
                <label className="field-label">Where it goes</label>
                <select className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  {targets.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>

              {target?.kind === 'server' && (
                <>
                  <div className="field" style={{ width: 110 }}>
                    <label className="field-label">Pack port</label>
                    <input
                      className="input"
                      type="number"
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value) || 25567)}
                    />
                  </div>

                  <div className="field" style={{ flex: '1 1 200px' }}>
                    <label className="field-label">Who has to reach it</label>
                    <select
                      className="select"
                      value={reachFor}
                      onChange={(e) => setReachFor(e.target.value as typeof reachFor)}
                    >
                      <option value="house">
                        Me and my network{host?.localAddress ? ` (${host.localAddress})` : ''}
                      </option>
                      <option value="internet">Players over the internet</option>
                      <option value="typed">An address I type</option>
                    </select>
                  </div>

                  {reachFor === 'typed' && (
                    <div className="field" style={{ flex: '1 1 180px' }}>
                      <label className="field-label">Address</label>
                      <input
                        className="input"
                        value={address}
                        placeholder="play.yourserver.net"
                        onChange={(e) => setAddress(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )}

              <button
                className="btn"
                disabled={busy || nothing}
                title={nothing ? 'There is nothing in the pack yet' : 'Write it out as a .zip'}
                onClick={() => void exportZip()}
              >
                {busy && <Spinner />} Save as a file
              </button>

              <button
                className="btn btn-primary"
                title={nothing ? 'There is nothing in the pack yet' : !target ? 'Pick where it goes first' : undefined}
                disabled={busy || nothing || !target}
                onClick={() => void install()}
              >
                {busy && <Spinner />}
                {target?.kind === 'server' ? <Server size={14} /> : <Upload size={14} />}
                {target?.kind === 'server' ? ' Build and serve it' : ' Build and install it'}
              </button>
            </div>

            {target?.kind === 'server' ? (
              <>
                <p className="tiny dim">
                  The server hands out a link, not the file — so the launcher serves the pack over that port for as long
                  as it is open. Windows will ask before anything listens on it.
                </p>

                {/*
                 * server.properties holds exactly one url, and on a router that
                 * will not hairpin, no single address reaches both the machine
                 * that made the pack and the internet. Saying which one you have
                 * chosen beats picking silently and letting the other fail.
                 */}
                <p className="tiny dim">
                  {reachFor === 'house'
                    ? 'Works for you and anyone in the house. Players joining over the internet will not be able to fetch it.'
                    : reachFor === 'internet'
                      ? 'Works for players outside. Many home routers will not send you back to your own public address, so you may not be able to fetch it yourself — install it with "(just me)" to test.'
                      : 'Whatever you type goes into server.properties as it is.'}
                </p>

                {/*
                 * The same button the server port gets, for the pack port.
                 *
                 * Having forwarded 25565 does nothing for this one: the game speaks its own
                 * protocol and this speaks http, so they cannot share a port. Somebody whose
                 * server friends can already join would otherwise hand out a pack link that
                 * only works inside their own house.
                 */}
                <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                  {forwarding?.open ? (
                    <>
                      <span className="small">
                        Port {port} is open{forwarding.router ? ` via ${forwarding.router}` : ''}.
                      </span>
                      <button className="btn btn-sm" disabled={asking} onClick={() => void closeThePort()}>
                        {asking && <Spinner />} Close it again
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-sm" disabled={asking} onClick={() => void openThePort()}>
                        {asking && <Spinner />} <Globe size={14} /> Open port {port} for friends
                      </button>
                      <button className="btn btn-sm" disabled={asking} onClick={() => void checkPort()}>
                        Check it
                      </button>
                    </>
                  )}

                  {forwarding?.externalAddress && (
                    <span className="tiny dim">Your address: {forwarding.externalAddress}</span>
                  )}
                </div>

                {forwarding && !forwarding.available && (
                  <p className="tiny dim">
                    {forwarding.reason ??
                      'No router on this network offered to forward a port. Forward TCP ' +
                        port +
                        ' to this machine by hand instead.'}
                  </p>
                )}

                <p className="tiny dim">
                  This is a different port from the one players connect on — the game speaks its own protocol and the
                  pack is fetched over http, so having forwarded your server port does nothing for this one.
                </p>
              </>
            ) : (
              <p className="tiny dim">
                Written into this instance&apos;s resourcepacks folder. Turn it on in game under Options, then Resource
                Packs.
              </p>
            )}

            {nothing && (
              <p className="small" style={{ color: 'var(--warning)' }}>
                Nothing in the pack yet, so there is nothing to build — add a texture, a hat, a sound or a menu
                background and the button wakes up.
              </p>
            )}
          </div>
          {built && (
            <div className="panel panel-pad col gap-12">
              <div className="section-title">Built</div>

              <p className="small muted">
                {packSummary(built.contents)} &mdash; {(built.bytes / 1024).toFixed(0)}KB.
              </p>

              {/*
                A pack can be built, served, downloaded and applied perfectly
                and change nothing, because a texture "replaced" with an
                identical copy of the original is still the original. Said here
                rather than discovered by standing in a world looking at three
                thousand unchanged blocks.
              */}
              {built.contents.unchanged !== null && built.contents.unchanged > 0 && (
                <p
                  className="small"
                  style={{
                    color: built.contents.unchanged === built.contents.textures ? 'var(--danger)' : 'var(--warning)'
                  }}
                >
                  {built.contents.unchanged === built.contents.textures
                    ? `Every one of these ${built.contents.textures.toLocaleString()} textures is identical to the game's own, so this pack will look exactly like vanilla. Pick a look under Restyle them and run it before building.`
                    : `${built.contents.unchanged.toLocaleString()} of ${built.contents.textures.toLocaleString()} textures are identical to the game's own and will change nothing.`}
                </p>
              )}

              {url && (
                <>
                  <div className="row gap-8" style={{ alignItems: 'center' }}>
                    <code className="tiny selectable" style={{ flex: 1, wordBreak: 'break-all' }}>
                      {url}
                    </code>
                    <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(url)}>
                      Copy
                    </button>
                  </div>

                  <label className="row gap-4 small" style={{ alignItems: 'center' }}>
                    <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                    Kick anyone who refuses it
                  </label>

                  {/*
                   * What the probe found, said plainly.
                   *
                   * The failure this catches is the worst kind to debug from the
                   * game: everything is configured correctly, and the download
                   * fails anyway because the router will not route this machine
                   * back to its own public address.
                   */}
                  {reach && !reach.ok && (
                    <div className="col gap-8">
                      <p className="small" style={{ color: 'var(--warning)', margin: 0 }}>
                        That link does not answer from this PC.
                      </p>

                      <p className="tiny dim" style={{ margin: 0 }}>
                        Almost always because your router will not send you back to your own public address. It can
                        still be the right link for friends joining from outside &mdash; but you will not be able to
                        download it yourself, so test with someone else or install the pack for yourself with the
                        &quot;(just me)&quot; target instead.
                      </p>

                      {reach.alternative && (
                        <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                          <button
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() => {
                              setAddress(reach.alternative!.split('//')[1]?.split(':')[0] ?? '')
                              void install()
                            }}
                          >
                            Use my local address instead
                          </button>
                          <span className="tiny dim">
                            Works for you and anyone in the house, not over the internet.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {reach?.ok && (
                    <p className="tiny" style={{ color: 'var(--success)' }}>
                      Checked &mdash; that link answers.
                    </p>
                  )}

                  <p className="tiny dim">
                    {built.offering
                      ? 'The plugin has already been told, so anyone joining is offered it now. No restart.'
                      : 'Start the server and it will offer the pack when people join.'}{' '}
                    The link has the pack&apos;s own hash in it, so rebuilding gives a new link and nobody is left on a
                    stale copy.
                  </p>
                </>
              )}

              {built.commands.length > 0 && (
                <>
                  <div className="section-title">Getting the custom items</div>

                  <div className="col gap-4">
                    {built.commands.map((command) => (
                      <div key={command} className="row gap-8" style={{ alignItems: 'center' }}>
                        <code className="tiny selectable" style={{ flex: 1, wordBreak: 'break-all' }}>
                          {command}
                        </code>
                        <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(command)}>
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {host?.running && (
        <div className="panel panel-pad row gap-8" style={{ alignItems: 'center' }}>
          <span className="small" style={{ flex: 1 }}>
            Serving the pack on port {host.port}.
          </span>
          <button className="btn btn-sm" onClick={() => void stopServing()}>
            Stop serving
          </button>
        </div>
      )}
    </div>
  )
}
