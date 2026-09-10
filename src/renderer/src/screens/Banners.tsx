/**
 * Designing a banner once and using it three ways.
 *
 * The design is a base colour and up to six pattern layers — the same thing a
 * loom makes — so the preview here is not an impression of the result, it is
 * the result. The artwork is Minecraft's own, and the arithmetic is what the
 * game does, which is why the block a player ends up holding matches the
 * picture on this screen.
 *
 * From that one design come the banner block, the 64x64 server icon, and a wide
 * image for a listing site. Rendering happens on a canvas here rather than in
 * the main process, so there is no image library to ship and the preview and
 * the exported file are produced by the same code.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Flag,
  Image as ImageIcon,
  Plus,
  Sparkles,
  Trash2,
  Wand2
} from 'lucide-react'

import type { HostedServer, LauncherErrorPayload } from '@shared/types'
import {
  BANNER_HEIGHT,
  BANNER_WIDTH,
  DYES,
  LOOM_PATTERNS,
  MAX_LAYERS,
  SPECIAL_PATTERNS,
  describeDesign,
  dyeLabel,
  giveCommand,
  patternLabel,
  renderBanner,
  supportsGive,
  type BannerBrain,
  type BannerDesign
} from '@shared/banners'

import { validTarget } from '@shared/creations'
import { api, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { ErrorView, Modal, Spinner } from '../components/ui'
import { PromptChips } from '../components/PromptChips'
import { DesignTools } from '../components/DesignTools'

/* --------------------------------------------------------------- painting */

/**
 * Draws a design into a canvas at whatever size is asked for.
 *
 * Through an unscaled 20x40 buffer and then up with smoothing off, because a
 * banner is pixel art: smoothed, the crisp diagonals turn to mush and the
 * preview stops resembling the block.
 */
function paint(
  ctx: CanvasRenderingContext2D,
  design: BannerDesign,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const buffer = document.createElement('canvas')
  buffer.width = BANNER_WIDTH
  buffer.height = BANNER_HEIGHT

  const inner = buffer.getContext('2d')
  if (!inner) return

  const image = inner.createImageData(BANNER_WIDTH, BANNER_HEIGHT)
  image.data.set(renderBanner(design))
  inner.putImageData(image, 0, 0)

  ctx.imageSmoothingEnabled = false
  ctx.drawImage(buffer, x, y, width, height)
}

/** The base colour, darkened, so a banner has something to sit against. */
function backdrop(design: BannerDesign, amount = 0.28): string {
  const hexish = DYES[design.base] ?? DYES.black
  const channel = (at: number): number =>
    Math.round(parseInt(hexish.slice(at, at + 2), 16) * amount)
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`
}

/** A banner drawn on a canvas, at a fixed size. */
function BannerView({
  design,
  width,
  height,
  title
}: {
  design: BannerDesign
  width: number
  height: number
  title?: string
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    paint(ctx, design, 0, 0, width, height)
  }, [design, width, height])

  return <canvas ref={ref} width={width} height={height} title={title} style={{ display: 'block' }} />
}

/* ---------------------------------------------------------------- outputs */

/**
 * The server icon: 64x64, which is what Minecraft insists on.
 *
 * A banner is half as wide as it is tall, so it cannot fill a square on its
 * own. It is drawn full height against its own base colour darkened, which
 * reads as deliberate at the size a server list actually shows.
 */
function iconPng(design: BannerDesign): string {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64

  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = backdrop(design)
  ctx.fillRect(0, 0, 64, 64)
  paint(ctx, design, 16, 0, 32, 64)

  return canvas.toDataURL('image/png')
}

const LISTING_WIDTH = 1000
const LISTING_HEIGHT = 200

/** The wide image listing sites ask for, with the server's name on it. */
function listingPng(design: BannerDesign, name: string, tagline: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = LISTING_WIDTH
  canvas.height = LISTING_HEIGHT

  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const gradient = ctx.createLinearGradient(0, 0, LISTING_WIDTH, LISTING_HEIGHT)
  gradient.addColorStop(0, backdrop(design, 0.34))
  gradient.addColorStop(1, backdrop(design, 0.1))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, LISTING_WIDTH, LISTING_HEIGHT)

  // Two banners, one at each end, so the image reads as a banner either side.
  paint(ctx, design, 48, 20, 80, 160)
  paint(ctx, design, LISTING_WIDTH - 128, 20, 80, 160)

  ctx.fillStyle = DYES[design.base] ?? '#ffffff'
  ctx.fillRect(160, 40, 3, 120)

  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 54px "Segoe UI", system-ui, sans-serif'
  ctx.fillText(name.slice(0, 24) || 'Your Server', 192, tagline.trim() ? 82 : 100)

  if (tagline.trim()) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)'
    ctx.font = '28px "Segoe UI", system-ui, sans-serif'
    ctx.fillText(tagline.slice(0, 48), 192, 132)
  }

  return canvas.toDataURL('image/png')
}

/* ------------------------------------------------------------------ screen */

const BLANK: BannerDesign = { name: 'Banner', base: 'white', layers: [] }

export function BannersScreen(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)

  /*
   * The design lives in the store, not here.
   *
   * This screen is unmounted the instant another tab is opened, so a design
   * held in component state is gone by the time anyone comes back to it.
   */
  const stored = useStore((s) => s.bannerDesign)
  const setBannerDesign = useStore((s) => s.setBannerDesign)
  const design = stored ?? BLANK

  const setDesign = useCallback(
    (next: BannerDesign | ((current: BannerDesign) => BannerDesign)) => {
      setBannerDesign(
        typeof next === 'function'
          ? (next as (current: BannerDesign) => BannerDesign)(useStore.getState().bannerDesign ?? BLANK)
          : next
      )
    },
    [setBannerDesign]
  )
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const [brains, setBrains] = useState<BannerBrain[] | null>(null)
  const [brainId, setBrainId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [designing, setDesigning] = useState(false)
  const [dropped, setDropped] = useState<string[]>([])

  const [servers, setServers] = useState<HostedServer[]>([])
  const [serverId, setServerId] = useState('')
  const [target, setTarget] = useState('@a')
  const [players, setPlayers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const title = useStore((s) => s.bannerTitle)
  const tagline = useStore((s) => s.bannerTagline)
  const setBannerText = useStore((s) => s.setBannerText)
  const setTitle = useCallback((v: string) => setBannerText({ title: v }), [setBannerText])
  const setTagline = useCallback((v: string) => setBannerText({ tagline: v }), [setBannerText])
  const [picking, setPicking] = useState<number | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [available, hosted] = await Promise.all([api.banners.brains(), api.host.list()])
        setBrains(available)
        setServers(hosted)

        const usable = available.find((b) => b.ready)
        if (usable) setBrainId(usable.id)
        if (hosted.length) setServerId(hosted[0].id)
      } catch (err) {
        setError(toPayload(err))
        setBrains([])
      }
    })()
  }, [])

  const server = useMemo(() => servers.find((s) => s.id === serverId) ?? null, [servers, serverId])

  /*
   * Who is actually on, so a name is chosen rather than typed.
   *
   * The box here held "@a" and accepted anything typed after it, which is how
   * "@aDave0734" came to be sent - a complete selector with a name stuck on
   * the end, which the server refuses outright.
   */
  useEffect(() => {
    if (!serverId) return

    let stop = false

    const look = async (): Promise<void> => {
      try {
        const states = await api.host.states()
        if (!stop) setPlayers(states.find((s) => s.id === serverId)?.players ?? [])
      } catch {
        /* Not worth an error if the server is not answering. */
      }
    }

    void look()
    const timer = setInterval(() => void look(), 5000)

    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [serverId])

  /*
   * The title on the listing image.
   *
   * Follows the server's name, then whatever the AI called the design, until
   * something is typed - at which point the typing wins and stays won, which is
   * why the empty string is meaningful here rather than a missing value.
   */
  const listingName =
    title || (design.name && design.name !== 'Banner' ? design.name : server?.name ?? '')

  /* The text is a parameter so a suggestion chip does not ask with the last one. */
  const ask = useCallback(
    async (text?: string) => {
      const wanted = (text ?? prompt).trim()
      if (!wanted || !brainId) return
      if (text) setPrompt(text)

      setDesigning(true)
      setError(null)
      setDropped([])

      try {
        const result = await api.banners.design(wanted, brainId)
        setDesign(result.design)
        setDropped(result.dropped)

        if (result.dropped.length) {
          pushToast({
            kind: 'info',
            title: 'Some layers were made up',
            message: `${result.model} named ${result.dropped.length} pattern${
              result.dropped.length === 1 ? '' : 's'
            } that do not exist. The rest was kept.`
          })
        }
      } catch (err) {
        setError(toPayload(err))
      } finally {
        setDesigning(false)
      }
    },
    [prompt, brainId, pushToast]
  )

  const setLayer = (index: number, patch: Partial<BannerDesign['layers'][number]>): void =>
    setDesign((d) => ({
      ...d,
      layers: d.layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer))
    }))

  const move = (index: number, by: number): void =>
    setDesign((d) => {
      const to = index + by
      if (to < 0 || to >= d.layers.length) return d
      const layers = [...d.layers]
      const [held] = layers.splice(index, 1)
      layers.splice(to, 0, held)
      return { ...d, layers }
    })

  const give = async (): Promise<void> => {
    if (!server) return

    // A backstop behind the dropdown, since the server's refusal arrives in
    // its log rather than anywhere the person who pressed the button looks.
    if (!validTarget(target)) {
      pushToast({
        kind: 'error',
        title: 'That is not a player',
        message: `"${target}" is neither a name nor a selector.`
      })
      return
    }

    setBusy(true)
    try {
      const result = await api.banners.give(server.id, target.trim() || '@a', design)
      if (!result.sent) {
        await navigator.clipboard.writeText(`/${result.command}`)
        pushToast({
          kind: 'info',
          title: 'Command copied instead',
          message: 'The server is not running, so it was not sent.'
        })
      }
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const setIcon = async (): Promise<void> => {
    if (!server) return
    setBusy(true)
    try {
      await api.banners.icon(server.id, iconPng(design))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const saveListing = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await api.app.pickSavePath({
        title: 'Save the listing image',
        defaultName: `${(listingName || 'server').replace(/[^\w-]+/g, '-').toLowerCase()}-banner.png`,
        extensions: ['png']
      })
      if (path) await api.banners.save(path, listingPng(design, listingName, tagline))
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const copyCommand = async (): Promise<void> => {
    await navigator.clipboard.writeText(`/${giveCommand(design, target.trim() || '@a')}`)
    pushToast({
      kind: 'success',
      title: 'Copied',
      message: 'Paste it into the server console or a command block.'
    })
  }

  const tooOld = server ? !supportsGive(server.minecraftVersion) : false
  const ready = brains?.filter((b) => b.ready) ?? []

  return (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Your server</div>
          <h1>Banners</h1>
          <p className="subtitle">
            Design a banner once and use it three ways — as a block a player can hold, as the icon
            your server shows in the server list, and as a wide image for a listing site. The
            preview uses Minecraft&apos;s own artwork, so what you see is what gets built.
          </p>
        </div>
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      <div className="row gap-24 items-start wrap">
        {/* ------------------------------------------------------ designing */}
        <div className="flex-1 col gap-12" style={{ minWidth: 380 }}>
          <div className="panel panel-pad col gap-12">
            <div className="section-title">
              <Wand2 size={15} /> Describe it
            </div>

            {brains === null ? (
              <Spinner />
            ) : ready.length === 0 ? (
              <p className="small muted">
                No AI is set up yet. Add one on the AI Companion tab — Ollama runs on this PC for
                free — or just build a banner by hand below.
              </p>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="a red and gold shield for a kingdom server"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void ask()
                  }}
                />
                <div className="row gap-8 wrap">
                  <select
                    className="input"
                    style={{ flex: 1, minWidth: 160 }}
                    value={brainId}
                    onChange={(e) => setBrainId(e.target.value)}
                  >
                    {ready.map((brain) => (
                      <option key={brain.id} value={brain.id}>
                        {brain.label} — {brain.model}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    disabled={designing || !prompt.trim()}
                    onClick={() => void ask()}
                  >
                    {designing ? <Spinner /> : <Sparkles size={15} />} Design it
                  </button>
                </div>
                <PromptChips kind="banner" disabled={designing} onPick={(text) => void ask(text)} />

                {dropped.length > 0 && (
                  <p className="tiny dim">
                    Ignored {dropped.length} layer{dropped.length === 1 ? '' : 's'} the AI invented:{' '}
                    {dropped.join(', ')}
                  </p>
                )}
              </>
            )}
          </div>

          <DesignTools
            kind="banner"
            design={design}
            name={design.name}
            prompt={prompt}
            brainId={brainId}
            busy={designing}
            onLoad={(d) => setDesign(d)}
            onError={setError}
            preview={(d) => <BannerView design={d} width={40} height={80} />}
          />

          {/* ---------------------------------------------------- by hand */}
          <div className="panel panel-pad col gap-12">
            <div className="section-title">
              <Flag size={15} /> Base colour
            </div>
            <Swatches
              selected={design.base}
              onPick={(base) => setDesign((d) => ({ ...d, base }))}
            />
          </div>

          <div className="panel panel-pad col gap-12">
            <div className="row gap-8" style={{ justifyContent: 'space-between' }}>
              <div className="section-title">Layers</div>
              <button
                className="btn btn-sm"
                disabled={design.layers.length >= MAX_LAYERS}
                onClick={() =>
                  setDesign((d) => ({
                    ...d,
                    layers: [...d.layers, { pattern: 'stripe_bottom', colour: 'black' }]
                  }))
                }
              >
                <Plus size={14} /> Add
              </button>
            </div>

            {design.layers.length === 0 && (
              <p className="small muted">
                A plain banner. Add up to {MAX_LAYERS} layers — the same limit a loom has.
              </p>
            )}

            {design.layers.map((layer, index) => (
              <div key={index} className="panel panel-pad col gap-8">
                <div className="row gap-8">
                  <BannerView
                    design={{ ...design, layers: design.layers.slice(0, index + 1) }}
                    width={20}
                    height={40}
                  />
                  <button
                    className="btn btn-sm flex-1"
                    onClick={() => setPicking(index)}
                    title="Choose a pattern"
                  >
                    {patternLabel(layer.pattern)}
                  </button>
                  <button
                    className="btn btn-ghost btn-icon"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    title="Move back"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon"
                    disabled={index === design.layers.length - 1}
                    onClick={() => move(index, 1)}
                    title="Move forward"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon"
                    onClick={() =>
                      setDesign((d) => ({ ...d, layers: d.layers.filter((_, i) => i !== index) }))
                    }
                    title="Remove"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <Swatches
                  selected={layer.colour}
                  onPick={(colour) => setLayer(index, { colour })}
                />
              </div>
            ))}
          </div>
        </div>

        {/* -------------------------------------------------------- output */}
        <div className="col gap-12" style={{ width: 340 }}>
          <div className="panel panel-pad col gap-12">
            <div className="section-title">The banner</div>
            <div
              className="row gap-24 center"
              style={{ background: backdrop(design), borderRadius: 8, padding: 16 }}
            >
              <BannerView design={design} width={120} height={240} title={describeDesign(design)} />
            </div>
            <p className="tiny dim">{describeDesign(design)}</p>
          </div>

          <div className="panel panel-pad col gap-12">
            <div className="section-title">Where it goes</div>

            {servers.length === 0 ? (
              <p className="small muted">
                No server is set up here yet. You can still save the images below.
              </p>
            ) : (
              <select
                className="input"
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.minecraftVersion})
                  </option>
                ))}
              </select>
            )}

            {server && (
              <>
                <div className="field">
                  <label className="field-label">Give it to</label>
                  <select
                    className="select"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="@a">Everyone</option>
                    <option value="@p">Nearest player</option>
                    {players.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <p className="field-hint mt-8">
                    {players.length === 0
                      ? 'Nobody is on the server right now.'
                      : `${players.length} online.`}
                  </p>
                </div>

                {tooOld ? (
                  <p className="small muted">
                    Minecraft {server.minecraftVersion} describes banner items in an older way this
                    does not write. The images below still work.
                  </p>
                ) : (
                  <div className="row gap-8 wrap">
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void give()}>
                      <Flag size={14} /> Give in game
                    </button>
                    <button className="btn btn-sm" onClick={() => void copyCommand()}>
                      <Copy size={14} /> Copy command
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="panel panel-pad col gap-12">
            <div className="section-title">Server icon</div>
            <div className="row gap-12 center">
              <IconPreview design={design} />
            </div>
            <button
              className="btn btn-sm"
              disabled={busy || !server}
              onClick={() => void setIcon()}
            >
              <ImageIcon size={14} /> Set as this server&apos;s icon
            </button>
            <p className="tiny dim">
              Written as server-icon.png. Minecraft reads it when the server starts.
            </p>
          </div>

          <div className="panel panel-pad col gap-12">
            <div className="section-title">Listing image</div>
            <div className="field">
              <label className="field-label">Title</label>
              <input
                className="input"
                value={listingName}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Your Server"
              />
            </div>
            <div className="field">
              <label className="field-label">Tagline</label>
              <input
                className="input"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Minigames, survival and more"
              />
            </div>
            <ListingPreview design={design} name={listingName} tagline={tagline} />
            <button className="btn btn-sm" disabled={busy} onClick={() => void saveListing()}>
              <ImageIcon size={14} /> Save the image
            </button>
            <p className="tiny dim">
              {LISTING_WIDTH}x{LISTING_HEIGHT}, which most listing sites accept.
            </p>
          </div>
        </div>
      </div>

      <PatternPicker
        open={picking !== null}
        design={design}
        index={picking ?? 0}
        onClose={() => setPicking(null)}
        onPick={(pattern) => {
          if (picking !== null) setLayer(picking, { pattern })
          setPicking(null)
        }}
      />
    </>
  )
}

/* ----------------------------------------------------------------- pieces */

function Swatches({
  selected,
  onPick
}: {
  selected: string
  onPick: (dye: string) => void
}): JSX.Element {
  return (
    <div className="row gap-8 wrap">
      {Object.entries(DYES).map(([dye, hexish]) => (
        <button
          key={dye}
          title={dyeLabel(dye)}
          onClick={() => onPick(dye)}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: hexish,
            cursor: 'pointer',
            border:
              dye === selected ? '2px solid var(--text, #fff)' : '1px solid rgba(0, 0, 0, 0.35)',
            outline: dye === selected ? '1px solid rgba(0, 0, 0, 0.5)' : 'none'
          }}
        />
      ))}
    </div>
  )
}

/** The icon exactly as it will be written, drawn at three times the size. */
function IconPreview({ design }: { design: BannerDesign }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = backdrop(design)
    ctx.fillRect(0, 0, 192, 192)
    paint(ctx, design, 48, 0, 96, 192)
  }, [design])

  return <canvas ref={ref} width={192} height={192} style={{ borderRadius: 8 }} />
}

function ListingPreview({
  design,
  name,
  tagline
}: {
  design: BannerDesign
  name: string
  tagline: string
}): JSX.Element {
  const [url, setUrl] = useState('')
  useEffect(() => setUrl(listingPng(design, name, tagline)), [design, name, tagline])
  return <img src={url} alt="" style={{ width: '100%', borderRadius: 8 }} />
}

/**
 * Every pattern, drawn on the banner being edited.
 *
 * Shown as it will actually look — this layer's colour, on top of the layers
 * beneath it — rather than as an abstract shape, because the same pattern in a
 * different position is a different-looking banner.
 */
function PatternPicker({
  open,
  design,
  index,
  onClose,
  onPick
}: {
  open: boolean
  design: BannerDesign
  index: number
  onClose: () => void
  onPick: (pattern: string) => void
}): JSX.Element {
  const layer = design.layers[index]

  const preview = (pattern: string): BannerDesign => ({
    ...design,
    layers: [
      ...design.layers.slice(0, index),
      { pattern, colour: layer?.colour ?? 'black' }
    ]
  })

  const grid = (patterns: readonly string[]): JSX.Element => (
    <div className="row gap-8 wrap">
      {patterns.map((pattern) => (
        <button
          key={pattern}
          className="panel panel-hover"
          title={patternLabel(pattern)}
          onClick={() => onPick(pattern)}
          style={{
            padding: 6,
            cursor: 'pointer',
            border:
              layer?.pattern === pattern ? '2px solid var(--accent, #7aa2ff)' : '1px solid transparent'
          }}
        >
          <BannerView design={preview(pattern)} width={30} height={60} />
        </button>
      ))}
    </div>
  )

  return (
    <Modal open={open} title="Choose a pattern" onClose={onClose} width={620}>
      <div className="col gap-12">
        {grid(LOOM_PATTERNS)}

        <div className="section-title mt-8">Needs a pattern item</div>
        <p className="tiny dim">
          These cannot be made from a dye alone — the banner still works, but a player could not
          reproduce it at a loom without finding or trading for the pattern first.
        </p>
        {grid(SPECIAL_PATTERNS)}
      </div>
    </Modal>
  )
}
