/**
 * Four things you describe and the server ends up with.
 *
 * A server list message, a logo, a firework and a custom item. They share a tab
 * because they share a shape: say what you want, a language model returns
 * structured data, it is drawn or built here, and it goes to the server as a
 * setting or a command.
 *
 * None of them asks a model for a picture. That was measured rather than
 * assumed — asked for a grid of pixels both providers failed every attempt, and
 * neither can generate an image at all. What they are good at is naming things
 * and choosing numbers, so that is all they are asked to do; the drawing is
 * arithmetic, done here, in Minecraft's own lettering.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Copy,
  Flag,
  Flame,
  Image as ImageIcon,
  Map as MapIcon,
  MessageSquare,
  Package,
  Palette,
  Sparkles,
  Trophy,
  Type
} from 'lucide-react'

import type { HostedServer, LauncherErrorPayload } from '@shared/types'
import type { BannerBrain } from '@shared/banners'
import {
  ENCHANTMENTS,
  FIREWORK_SHAPES,
  ITEMS,
  MAX_FLIGHT,
  MOTD_COLOURS,
  MOTD_LINE_LIMIT,
  MOTD_STYLES,
  fireworkCommand,
  gradientAt,
  itemCommand,
  motdLength,
  readMotdLine,
  type FireworkDesign,
  type ItemDesign,
  type LogoDesign,
  type MotdDesign,
  type RecipeDesign,
  validTarget,
  type RecipePack,
  type LootPack,
  type LootRule
} from '@shared/creations'
import { drawOutlined, drawText, measure } from '../components/mcText'

import { api, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { ErrorView, Spinner } from '../components/ui'
import type { AdvancementDesign, AdvancementPack } from '@shared/advancements'
import { PromptChips } from '../components/PromptChips'
import { BannersScreen } from './Banners'
import { IconMakerScreen } from './IconMaker'
import { MapArtTab } from './MapArt'
import { PackMakerTab } from './PackMaker'
import { focusedInstance } from '../store/useStore'
import { EmptyState } from '../components/ui'
import { DesignTools } from '../components/DesignTools'

type Section =
  'motd' | 'logo' | 'icon' | 'banners' | 'firework' | 'item' | 'recipes' | 'loot' | 'advancement' | 'mapart' | 'pack'

const BLANK_MOTD: MotdDesign = { line1: '&aYour Server', line2: '&7Come and have a look' }

const BLANK_LOGO: LogoDesign = {
  name: 'NEXUS',
  tagline: 'a minecraft server',
  colours: ['#FED83D', '#F9801D'],
  outline: '#1D1D21',
  background: '#0B1020',
  transparent: false,
  taglineColour: '#AAAAAA'
}

const BLANK_FIREWORK: FireworkDesign = {
  name: 'Firework',
  flight: 1,
  bursts: [{ shape: 'large_ball', colours: ['#FF5555'], fades: [], trail: true, twinkle: false }]
}

const BLANK_ADVANCEMENTS: AdvancementPack = {
  name: 'Custom advancements',
  advancements: []
}

const BLANK_LOOT: LootPack = { name: 'Custom loot', rules: [] }

const BLANK_RECIPES: RecipePack = { name: 'Custom recipes', recipes: [] }

const BLANK_ITEM: ItemDesign = {
  id: 'diamond_sword',
  name: '',
  lore: [],
  enchants: [],
  unbreakable: false,
  count: 1
}

/* ------------------------------------------------------------------ screen */

export function GeneratorsScreen(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast)

  /*
   * Map art and the pack maker belong to an instance - they read that
   * version's own textures out of its jar - while everything else here is
   * server content and belongs to nothing. That is the only reason this screen
   * knows what an instance is.
   */
  const instance = useStore(focusedInstance)

  /*
   * Everything the user has made lives in the store, not here.
   *
   * This screen is thrown away when another tab is opened, so a design held in
   * component state does not survive the trip - which is exactly what happened.
   */
  const section = useStore((s) => s.genSection) as Section
  const setSection = useStore((s) => s.setGenSection)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  const [brains, setBrains] = useState<BannerBrain[] | null>(null)
  const [brainId, setBrainId] = useState('')
  const prompt = useStore((s) => s.genPrompt)
  const setPrompt = useStore((s) => s.setGenPrompt)
  const [designing, setDesigning] = useState(false)

  const [servers, setServers] = useState<HostedServer[]>([])
  const [serverId, setServerId] = useState('')
  const [target, setTarget] = useState('@a')
  const [players, setPlayers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const motd = useStore((s) => s.genMotd) ?? BLANK_MOTD
  const setMotd = useStore((s) => s.setGenMotd)
  const logo = useStore((s) => s.genLogo) ?? BLANK_LOGO
  const setLogo = useStore((s) => s.setGenLogo)
  const firework = useStore((s) => s.genFirework) ?? BLANK_FIREWORK
  const setFirework = useStore((s) => s.setGenFirework)
  const item = useStore((s) => s.genItem) ?? BLANK_ITEM
  const setItem = useStore((s) => s.setGenItem)
  const recipes = useStore((s) => s.genRecipes) ?? BLANK_RECIPES
  const setRecipes = useStore((s) => s.setGenRecipes)
  const loot = useStore((s) => s.genLoot) ?? BLANK_LOOT
  const setLoot = useStore((s) => s.setGenLoot)
  const advancements = useStore((s) => s.genAdvancements) ?? BLANK_ADVANCEMENTS
  const setAdvancements = useStore((s) => s.setGenAdvancements)

  useEffect(() => {
    void (async () => {
      try {
        const [available, hosted] = await Promise.all([api.banners.brains(), api.host.list()])
        setBrains(available)
        setServers(hosted)
        const usable = available.find((b) => b.ready)
        if (usable) setBrainId(usable.id)
        if (hosted.length) {
          setServerId(hosted[0].id)
          // Only before anything has been designed, or coming back to the tab
          // would overwrite the logo somebody had already made.
          if (!useStore.getState().genLogo) {
            setLogo({ ...BLANK_LOGO, name: hosted[0].name.toUpperCase().slice(0, 24) })
          }
        }
      } catch (err) {
        setError(toPayload(err))
        setBrains([])
      }
    })()
  }, [])

  const server = useMemo(() => servers.find((s) => s.id === serverId) ?? null, [servers, serverId])

  /*
   * Who is actually online, so a name can be chosen rather than typed.
   *
   * Polled rather than read once: somebody opens this tab, then joins the
   * server to receive the thing they are designing, and a list from a minute
   * ago would not have them in it.
   */
  useEffect(() => {
    if (!serverId) return

    let stop = false

    const look = async (): Promise<void> => {
      try {
        const states = await api.host.states()
        if (stop) return

        setPlayers(states.find((s) => s.id === serverId)?.players ?? [])
      } catch {
        /* The server not answering is not worth an error here. */
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
   * The text is a parameter, not read back out of state.
   *
   * A suggestion chip sets the box and asks in the same breath, and reading
   * `prompt` here would use whatever was in it before the click.
   */
  const ask = useCallback(
    async (text?: string) => {
      const wanted = (text ?? prompt).trim()
      if (!wanted || !brainId) return
      if (text) setPrompt(text)

      setDesigning(true)
      setError(null)

      try {
        if (section === 'motd') {
          setMotd((await api.banners.designMotd(wanted, brainId)).design)
        } else if (section === 'logo') {
          setLogo((await api.banners.designLogo(wanted, brainId)).design)
        } else if (section === 'firework') {
          const got = await api.banners.designFirework(wanted, brainId)
          setFirework(got.design)
          if (got.dropped > 0) {
            pushToast({
              kind: 'info',
              title: 'Some bursts were skipped',
              message: `${got.dropped} could not be read. The rest was kept.`
            })
          }
        } else if (section === 'advancement') {
          const got = await api.banners.designAdvancements(wanted, brainId)
          setAdvancements(got.pack)
          if (got.dropped.length) {
            pushToast({
              kind: 'info',
              title: 'Some were dropped',
              message: got.dropped.join('; ')
            })
          }
        } else if (section === 'loot') {
          const got = await api.banners.designLoot(wanted, brainId)
          setLoot(got.pack)
          if (got.dropped.length) {
            pushToast({
              kind: 'info',
              title: 'Some rules were dropped',
              message: got.dropped.join('; ')
            })
          }
        } else if (section === 'recipes') {
          const got = await api.banners.designRecipes(wanted, brainId)
          setRecipes(got.pack)
          if (got.dropped.length) {
            pushToast({
              kind: 'info',
              title: 'Some recipes were dropped',
              message: got.dropped.join('; ')
            })
          }
        } else {
          const got = await api.banners.designItem(wanted, brainId)
          setItem(got.design)
          if (got.dropped.length) {
            pushToast({
              kind: 'info',
              title: 'Some of it was adjusted',
              message: got.dropped.join(', ')
            })
          }
        }
      } catch (err) {
        setError(toPayload(err))
      } finally {
        setDesigning(false)
      }
    },
    [prompt, brainId, section, pushToast]
  )

  const command =
    section === 'firework' ? fireworkCommand(firework, target.trim() || '@a') : itemCommand(item, target.trim() || '@a')

  const send = async (): Promise<void> => {
    if (!server) return

    // Checked before it goes, because the server's refusal arrives in its log
    // rather than anywhere the person who pressed the button will see it.
    if (!validTarget(target)) {
      pushToast({
        kind: 'error',
        title: 'That is not a player',
        message: `"${target}" is neither a name nor a selector. Pick one from the list.`
      })
      return
    }

    setBusy(true)
    try {
      const result = await api.banners.giveDesigned(server.id, command)
      if (!result.sent) await navigator.clipboard.writeText(`/${result.command}`)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const saveMotd = async (): Promise<void> => {
    if (!server) return
    setBusy(true)
    try {
      await api.banners.applyMotd(server.id, motd)
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const ready = brains?.filter((b) => b.ready) ?? []

  /*
   * Everything you make, in one place.
   *
   * Banners and the server icon had their own entries down the sidebar, and
   * map art and the pack maker were tabs inside Mods & Packs - so making
   * something meant knowing which of three places it lived in. The rule now is
   * plain: Mods & Packs is what you install, this is what you make.
   */
  /*
   * The four that arrived from elsewhere are whole screens already.
   *
   * Everything else here shares one shape - describe it to a model, then tune
   * it by hand - and these four do not: they have their own pickers, previews
   * and ways of saving. So they get the header and the tabs and nothing else,
   * rather than the shared half being reshaped to fit around them.
   */
  const OWN_SCREEN: Section[] = ['icon', 'banners', 'mapart', 'pack']

  const TABS: [Section, string, typeof Type][] = [
    ['motd', 'Server message', MessageSquare],
    ['logo', 'Logo', Type],
    ['icon', 'Server icon', ImageIcon],
    ['banners', 'Banners', Flag],
    ['firework', 'Firework', Flame],
    ['item', 'Custom item', Package],
    ['recipes', 'Recipes', BookOpen],
    ['loot', 'Loot', Package],
    ['advancement', 'Advancements', Trophy],
    ['mapart', 'Map art', MapIcon],
    ['pack', 'Resource pack', Palette]
  ]

  const chrome = (
    <>
      <div className="screen-header">
        <div>
          <div className="eyebrow">Your server</div>
          <h1>Generators</h1>
          <p className="subtitle">
            Describe what you want and get it built. The lettering is Minecraft&apos;s own, taken from the game, so a
            message or a logo looks the way it will look in the game rather than approximately like it.
          </p>
        </div>
      </div>

      {error && <ErrorView error={error} onDismiss={() => setError(null)} />}

      {/*
       * The app's own tab strip, rather than a row of filled buttons.
       *
       * Six primary-coloured pills in a row read as six things to press, and
       * the selected one looked no more selected than the rest did urgent.
       */}
      <div className="tab-strip mb-16">
        {TABS.map(([key, label, Icon]) => (
          <button key={key} className={section === key ? 'tab active' : 'tab'} onClick={() => setSection(key)}>
            <span className="row gap-8" style={{ alignItems: 'center' }}>
              <Icon size={14} /> {label}
            </span>
          </button>
        ))}
      </div>
    </>
  )

  if (OWN_SCREEN.includes(section)) {
    return (
      <>
        {chrome}

        {section === 'icon' && <IconMakerScreen />}
        {section === 'banners' && <BannersScreen />}

        {(section === 'mapart' || section === 'pack') &&
          (instance ? (
            <>
              {section === 'mapart' && <MapArtTab instance={instance} />}
              {section === 'pack' && <PackMakerTab instance={instance} />}
            </>
          ) : (
            <div className="panel">
              <EmptyState
                icon={<Palette size={24} />}
                title="No instance selected"
                message="Map art and resource packs are built from a particular Minecraft version's own files, so they need an instance. Create or pick one first."
              />
            </div>
          ))}
      </>
    )
  }

  /*
   * Past the early return, the section is one of the shared ones.
   *
   * TypeScript cannot see that through an Array.includes, and the prompt
   * chips are typed to the generators that actually have prompts - so the
   * narrowing is stated rather than the type widened to accept four sections
   * that never reach here.
   */
  const shared = section as Exclude<Section, 'icon' | 'banners' | 'mapart' | 'pack'>

  return (
    <>
      {chrome}

      {/* --------------------------------------------------- describe it */}
      <div className="panel panel-pad col gap-12 mb-16">
        {brains === null ? (
          <Spinner />
        ) : ready.length === 0 ? (
          <p className="small muted">
            No AI is set up yet. Add one on the AI Companion tab — Ollama runs on this PC for free — or build it by hand
            below.
          </p>
        ) : (
          <div className="row gap-8 wrap">
            <input
              className="input"
              style={{ flex: '2 1 260px' }}
              placeholder={
                section === 'motd'
                  ? 'a friendly message for a survival server'
                  : section === 'logo'
                    ? 'a bold gold logo for a kingdom server'
                    : section === 'firework'
                      ? 'a red and gold burst with a trail'
                      : section === 'recipes'
                        ? 'recipes to turn cobblestone back into ore'
                        : section === 'loot'
                          ? 'zombies drop an emerald one time in twenty'
                          : 'a legendary sword for a boss drop'
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void ask()
              }}
            />
            <select
              className="input"
              style={{ flex: '1 1 160px' }}
              value={brainId}
              onChange={(e) => setBrainId(e.target.value)}
            >
              {ready.map((brain) => (
                <option key={brain.id} value={brain.id}>
                  {brain.label} — {brain.model}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={designing || !prompt.trim()} onClick={() => void ask()}>
              {designing ? <Spinner /> : <Sparkles size={15} />} Design it
            </button>
          </div>
        )}

        {ready.length > 0 && <PromptChips kind={shared} disabled={designing} onPick={(text) => void ask(text)} />}
      </div>

      <div className="mb-16">
        {section === 'motd' && (
          <DesignTools
            kind="motd"
            design={motd}
            name="Server message"
            prompt={prompt}
            brainId={brainId}
            busy={designing}
            onLoad={setMotd}
            onError={setError}
            preview={(d) => (
              <div style={{ width: 260 }}>
                <MotdPreview design={d} />
              </div>
            )}
          />
        )}
        {section === 'logo' && (
          <DesignTools
            kind="logo"
            design={logo}
            name={logo.name}
            prompt={prompt}
            brainId={brainId}
            busy={designing}
            onLoad={setLogo}
            onError={setError}
            preview={(d) => <LogoThumb design={d} />}
          />
        )}
        {section === 'firework' && (
          <DesignTools
            kind="firework"
            design={firework}
            name={firework.name}
            prompt={prompt}
            brainId={brainId}
            busy={designing}
            onLoad={setFirework}
            onError={setError}
            preview={(d) => (
              <div style={{ width: 150 }}>
                <FireworkPreview design={d} />
              </div>
            )}
          />
        )}
        {section === 'recipes' && (
          <DesignTools
            kind="datapack"
            design={recipes}
            name={recipes.name}
            prompt={prompt}
            brainId={brainId}
            busy={designing}
            onLoad={setRecipes}
            onError={setError}
            preview={(p) => (
              <div className="col gap-8" style={{ width: 200, textAlign: 'left' }}>
                <strong className="small">{p.name}</strong>
                <span className="tiny dim">
                  {p.recipes?.length ?? 0} recipe{p.recipes?.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
          />
        )}
        {section === 'advancement' && (
          <DesignTools
            kind="advancement"
            design={advancements}
            name={advancements.name}
            prompt={prompt}
            brainId={brainId}
            busy={designing}
            onLoad={setAdvancements}
            onError={setError}
            preview={(p) => (
              <div className="col gap-8" style={{ width: 200, textAlign: 'left' }}>
                <strong className="small">{p.name}</strong>
                <span className="tiny dim">
                  {p.advancements?.length ?? 0} advancement
                  {p.advancements?.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
          />
        )}
        {section === 'advancement' && (
          <AdvancementSection
            pack={advancements}
            setPack={setAdvancements}
            servers={servers}
            busy={busy}
            setBusy={setBusy}
            onError={setError}
          />
        )}

        {section === 'loot' && (
          <DesignTools
            kind="loot"
            design={loot}
            name={loot.name}
            prompt={prompt}
            brainId={brainId}
            busy={designing}
            onLoad={setLoot}
            onError={setError}
            preview={(p) => (
              <div className="col gap-8" style={{ width: 200, textAlign: 'left' }}>
                <strong className="small">{p.name}</strong>
                <span className="tiny dim">
                  {p.rules?.length ?? 0} rule{p.rules?.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
          />
        )}
        {section === 'item' && (
          <DesignTools
            kind="item"
            design={item}
            name={item.name || item.id}
            prompt={prompt}
            brainId={brainId}
            busy={designing}
            onLoad={setItem}
            onError={setError}
            preview={(d) => (
              <div className="col gap-8" style={{ width: 200, textAlign: 'left' }}>
                <strong className="small">{d.name || d.id}</strong>
                <span className="tiny dim">{d.id}</span>
                <span className="tiny dim">
                  {d.enchants.length} enchantment{d.enchants.length === 1 ? '' : 's'}
                  {d.unbreakable ? ', unbreakable' : ''}
                </span>
              </div>
            )}
          />
        )}
      </div>

      {section === 'motd' && (
        <MotdSection
          design={motd}
          setDesign={setMotd}
          servers={servers}
          serverId={serverId}
          setServerId={setServerId}
          busy={busy}
          onSave={saveMotd}
        />
      )}

      {section === 'logo' && (
        <LogoSection design={logo} setDesign={setLogo} busy={busy} setBusy={setBusy} onError={setError} />
      )}

      {section === 'firework' && <FireworkSection design={firework} setDesign={setFirework} />}

      {section === 'item' && <ItemSection design={item} setDesign={setItem} />}

      {section === 'recipes' && (
        <RecipeSection
          pack={recipes}
          setPack={setRecipes}
          servers={servers}
          serverId={serverId}
          setServerId={setServerId}
          busy={busy}
          setBusy={setBusy}
          onError={setError}
        />
      )}

      {section === 'loot' && (
        <LootSection pack={loot} setPack={setLoot} servers={servers} busy={busy} setBusy={setBusy} onError={setError} />
      )}

      {(section === 'firework' || section === 'item') && (
        <div className="panel panel-pad col gap-12 mt-16">
          <div className="section-title">Hand it over</div>

          <div className="row gap-8 wrap">
            {servers.length > 0 && (
              <select
                className="input"
                style={{ flex: '1 1 180px' }}
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
            <select
              className="input"
              style={{ flex: '1 1 150px' }}
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
            <button className="btn btn-primary btn-sm" disabled={busy || !server} onClick={() => void send()}>
              Give in game
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                void navigator.clipboard.writeText(`/${command}`)

                /*
                 * Minecraft's chat box holds 256 characters and says nothing
                 * when it drops the rest - the command arrives cut off
                 * mid-word and fails with a parse error that looks like the
                 * command being wrong rather than truncated.
                 */
                if (command.length + 1 > CHAT_LIMIT) {
                  pushToast({
                    kind: 'info',
                    title: 'Copied, but too long for chat',
                    message: `${command.length + 1} characters, and chat holds ${CHAT_LIMIT}. Paste it into a command block, or use Give in game.`
                  })
                  return
                }

                pushToast({ kind: 'success', title: 'Copied' })
              }}
            >
              <Copy size={14} /> Copy command
            </button>
          </div>

          <p className="tiny dim">
            {server
              ? 'Give in game runs it on the server console, so the world does not have to be open.'
              : 'Give in game needs a hosted server — nothing can type into a singleplayer session from outside. For a singleplayer world, copy the command and paste it into the game’s own chat.'}
          </p>

          {command.length + 1 > CHAT_LIMIT && (
            <p className="tiny" style={{ color: 'var(--warn, #e0a02a)' }}>
              {command.length + 1} characters. Chat only takes {CHAT_LIMIT}, so pasting this into the game will cut it
              off - use Give in game, or a command block.
            </p>
          )}

          <code className="tiny dim" style={{ wordBreak: 'break-all', display: 'block', lineHeight: 1.5 }}>
            /{command}
          </code>
        </div>
      )}
    </>
  )
}

/* -------------------------------------------------------------------- motd */

/** The server list message, drawn the way the game draws it. */
function MotdPreview({ design }: { design: MotdDesign }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const SCALE = 3

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return

    const width = 560
    const height = 90
    ctx.clearRect(0, 0, width, height)

    // The dirt-grey the server list sits on, so contrast reads honestly.
    ctx.fillStyle = '#2b2b2b'
    ctx.fillRect(0, 0, width, height)

    const line = (text: string, y: number): void => {
      let x = 10
      for (const run of readMotdLine(text)) {
        /*
         * Obfuscated text scrambles in game. Drawn as the real characters here
         * rather than animated, because a preview that will not hold still is
         * not a preview - the point is to judge the colours and the length.
         */
        x += drawText(ctx, run.text, x, y, SCALE, {
          colour: run.colour,
          bold: run.bold,
          italic: run.italic,
          underline: run.underline,
          strike: run.strike,
          shadow: true
        })
        x += SCALE
      }
    }

    line(design.line1, 16)
    line(design.line2, 50)
  }, [design])

  return <canvas ref={ref} width={560} height={90} style={{ borderRadius: 8, maxWidth: '100%' }} />
}

function MotdSection({
  design,
  setDesign,
  servers,
  serverId,
  setServerId,
  busy,
  onSave
}: {
  design: MotdDesign
  setDesign: (d: MotdDesign) => void
  servers: HostedServer[]
  serverId: string
  setServerId: (id: string) => void
  busy: boolean
  onSave: () => Promise<void>
}): JSX.Element {
  const [line, setLine] = useState<1 | 2>(1)

  const server = servers.find((s) => s.id === serverId) ?? null

  /*
   * What the server is serving, as a design this screen can draw.
   *
   * Stored with section signs and an escaped newline, because that is what a
   * properties file holds; turned back into the ampersand form the editor
   * uses so the two can be compared and drawn by the same code.
   */
  const live = useMemo(() => {
    if (!server) return null

    const [one = '', two = ''] = server.motd.replace(/\\n/g, '\n').split('\n')

    return {
      line1: one.replace(/\u00a7/g, '&'),
      line2: two.replace(/\u00a7/g, '&')
    }
  }, [server])

  const matches = live !== null && live.line1 === design.line1 && live.line2 === design.line2

  const insert = (code: string): void => {
    const key = line === 1 ? 'line1' : 'line2'
    setDesign({ ...design, [key]: `${design[key]}&${code}` })
  }

  const rows: [1 | 2, string][] = [
    [1, design.line1],
    [2, design.line2]
  ]

  return (
    <div className="row gap-24 items-start wrap">
      <div className="col gap-12" style={{ flex: '1 1 420px' }}>
        <div className="panel panel-pad col gap-12">
          <div className="section-title">How it looks</div>
          <MotdPreview design={design} />
        </div>

        <div className="panel panel-pad col gap-12">
          {rows.map(([which, value]) => {
            const length = motdLength(value)
            const over = length > MOTD_LINE_LIMIT

            return (
              <div className="field" key={which}>
                <label className="field-label">
                  Line {which}{' '}
                  <span className={over ? 'tiny' : 'tiny dim'} style={over ? { color: 'var(--warning)' } : undefined}>
                    {length} of {MOTD_LINE_LIMIT}
                    {over ? ' — will be cut off' : ''}
                  </span>
                </label>
                <input
                  className="input"
                  value={value}
                  onFocus={() => setLine(which)}
                  onChange={(e) => setDesign({ ...design, [which === 1 ? 'line1' : 'line2']: e.target.value })}
                />
              </div>
            )
          })}

          <p className="tiny dim">Colours go into line {line}, wherever the cursor last was.</p>

          <div className="row gap-8 wrap">
            {MOTD_COLOURS.map(([code, name, hexish]) => (
              <button
                key={code}
                title={name}
                onClick={() => insert(code)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 5,
                  background: hexish,
                  cursor: 'pointer',
                  border: '1px solid rgba(0,0,0,0.4)'
                }}
              />
            ))}
          </div>

          <div className="row gap-8 wrap">
            {MOTD_STYLES.map(([code, name]) => (
              <button key={code} className="btn btn-sm" onClick={() => insert(code)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="col gap-12" style={{ flex: '1 1 260px' }}>
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Put it on the server</div>

          {servers.length === 0 ? (
            <p className="small muted">No server is set up here yet.</p>
          ) : (
            <select className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          <button className="btn btn-primary btn-sm" disabled={busy || !serverId} onClick={() => void onSave()}>
            Save as the server message
          </button>
          <p className="tiny dim">
            Written into the server&apos;s settings, so it survives the next restart. The server has to restart before
            anyone sees it.
          </p>

          {/*
           * What the server is serving right now, beside what is on screen.
           *
           * The preview above shows the design being edited, which is not the
           * same thing - a message designed and never saved looked, in the
           * app, exactly like a message that was live. Showing both makes the
           * difference visible instead of surprising.
           */}
          {live !== null && (
            <div className="col gap-8" style={{ marginTop: 4 }}>
              <div className="divider" />

              <span className="tiny dim">
                {matches ? 'The server is showing this' : 'The server is currently showing'}
              </span>

              <MotdPreview design={live} />

              {!matches && (
                <span className="tiny" style={{ color: 'var(--warn, #e0a02a)' }}>
                  Not what is above. Press the button to make it so.
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- logo */

/**
 * How much Minecraft's chat box will accept.
 *
 * Anything longer is silently cut off when pasted, so a long item command
 * fails in game with a parse error pointing at the middle of a word.
 */
const CHAT_LIMIT = 256

const LOGO_WIDTH = 960
const LOGO_HEIGHT = 320

/**
 * How big the lettering can be and still fit.
 *
 * Worked out here rather than at each call site, because it was worked out
 * twice - once by the painter and once by the caption underneath - and the two
 * drifted apart, so the picture said one thing and the label said another.
 */
function logoLayout(design: LogoDesign): { scale: number; small: number } {
  const OUTLINE = 1
  const GLYPH = 8
  const GAP = 1.2

  const nameUnits = Math.max(1, measure(design.name))
  const taglineShare = design.tagline ? GLYPH / 3 + GAP : 0

  const byWidth = (LOGO_WIDTH - 48) / (nameUnits + OUTLINE * 2)
  const byHeight = (LOGO_HEIGHT - 40) / (GLYPH + OUTLINE * 2 + taglineShare)

  // Whole numbers only: the font is pixel art and half a pixel is a blur.
  const scale = Math.max(2, Math.floor(Math.min(byWidth, byHeight)))

  return { scale, small: design.tagline ? Math.max(2, Math.floor(scale / 3)) : 0 }
}

function paintLogo(canvas: HTMLCanvasElement, design: LogoDesign): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, LOGO_WIDTH, LOGO_HEIGHT)
  if (!design.transparent) {
    ctx.fillStyle = design.background
    ctx.fillRect(0, 0, LOGO_WIDTH, LOGO_HEIGHT)
  }

  const letters = [...design.name]
  if (letters.length === 0) return

  /*
   * Sized to fit the canvas, not just its width.
   *
   * The scale used to come from the width alone, so a logo with a tagline was
   * laid out past the bottom edge - the tagline sat at y=312 on a 320-tall
   * canvas and only its top row of pixels was ever drawn, which looked like
   * specks of dirt under the name. The outline is counted too, since it is
   * drawn a full scale-step outside the letters on every side.
   */
  const OUTLINE = 1
  const GLYPH = 8
  const GAP = 1.2

  const nameUnits = Math.max(1, measure(design.name))
  const taglineUnits = design.tagline ? Math.max(1, measure(design.tagline)) : 0

  const { scale, small } = logoLayout(design)

  const blockHeight = GLYPH * scale + (design.tagline ? GAP * scale + GLYPH * small : 0)

  let x = (LOGO_WIDTH - nameUnits * scale) / 2
  const y = (LOGO_HEIGHT - blockHeight) / 2

  letters.forEach((ch, index) => {
    const fraction = letters.length === 1 ? 0 : index / (letters.length - 1)
    x += drawOutlined(
      ctx,
      ch,
      x,
      y,
      scale,
      { colour: gradientAt(design.colours, fraction), shadow: false },
      design.outline,
      OUTLINE
    )
  })

  if (design.tagline) {
    drawText(ctx, design.tagline, (LOGO_WIDTH - taglineUnits * small) / 2, y + GLYPH * scale + GAP * scale, small, {
      colour: design.taglineColour,
      shadow: !design.transparent
    })
  }
}

/** A logo at picker size, drawn by the same painter as the real one. */
function LogoThumb({ design }: { design: LogoDesign }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (ref.current) paintLogo(ref.current, design)
  }, [design])

  return (
    <canvas
      ref={ref}
      width={LOGO_WIDTH}
      height={LOGO_HEIGHT}
      style={{ width: 220, borderRadius: 6, imageRendering: 'pixelated' }}
    />
  )
}

function LogoSection({
  design,
  setDesign,
  busy,
  setBusy,
  onError
}: {
  design: LogoDesign
  setDesign: (d: LogoDesign) => void
  busy: boolean
  setBusy: (v: boolean) => void
  onError: (e: LauncherErrorPayload) => void
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (ref.current) paintLogo(ref.current, design)
  }, [design])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await api.app.pickSavePath({
        title: 'Save the logo',
        defaultName: `${design.name.toLowerCase().replace(/[^\w-]+/g, '-') || 'logo'}.png`,
        extensions: ['png']
      })
      if (path && ref.current) await api.banners.save(path, ref.current.toDataURL('image/png'))
    } catch (err) {
      onError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const swatch = (label: string, value: string, set: (v: string) => void): JSX.Element => (
    <div className="row gap-8" style={{ alignItems: 'center' }}>
      <input
        type="color"
        value={value}
        onChange={(e) => set(e.target.value)}
        style={{ width: 32, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
      />
      <span className="tiny dim">{label}</span>
    </div>
  )

  return (
    <div className="row gap-24 items-start wrap">
      <div className="panel panel-pad col gap-12" style={{ flex: '2 1 460px' }}>
        {/*
         * A checkerboard behind it, so a transparent logo reads as
         * transparent rather than as a black rectangle - which is what a
         * flat dark panel made it look like.
         */}
        <div
          style={{
            borderRadius: 10,
            padding: 12,
            border: '1px solid var(--border)',
            backgroundColor: '#15161c',
            backgroundImage: design.transparent
              ? 'linear-gradient(45deg, rgba(255,255,255,0.045) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.045) 75%), linear-gradient(45deg, rgba(255,255,255,0.045) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.045) 75%)'
              : undefined,
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 8px 8px'
          }}
        >
          <canvas
            ref={ref}
            width={LOGO_WIDTH}
            height={LOGO_HEIGHT}
            style={{ width: '100%', display: 'block', imageRendering: 'pixelated' }}
          />
        </div>
        <div className="row between" style={{ alignItems: 'center' }}>
          <span className="tiny dim">
            {LOGO_WIDTH}x{LOGO_HEIGHT}, Minecraft&apos;s own font
          </span>
          <span className="tiny dim">{logoLayout(design).scale}x</span>
        </div>
      </div>

      <div className="col gap-12" style={{ flex: '1 1 280px' }}>
        <div className="panel panel-pad col gap-12">
          <div className="field">
            <label className="field-label">Name</label>
            <input
              className="input"
              value={design.name}
              onChange={(e) => setDesign({ ...design, name: e.target.value.slice(0, 24) })}
            />
          </div>
          <div className="field">
            <label className="field-label">Tagline</label>
            <input
              className="input"
              value={design.tagline}
              onChange={(e) => setDesign({ ...design, tagline: e.target.value.slice(0, 48) })}
            />
          </div>

          <div className="section-title">Letters</div>
          <div className="row gap-8 wrap">
            {design.colours.map((colour, index) => (
              <input
                key={index}
                type="color"
                value={colour}
                onChange={(e) =>
                  setDesign({
                    ...design,
                    colours: design.colours.map((c, i) => (i === index ? e.target.value : c))
                  })
                }
                style={{ width: 32, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
              />
            ))}
            <button
              className="btn btn-sm"
              disabled={design.colours.length >= 4}
              onClick={() => setDesign({ ...design, colours: [...design.colours, '#55FFFF'] })}
            >
              +
            </button>
            <button
              className="btn btn-sm"
              disabled={design.colours.length <= 1}
              onClick={() => setDesign({ ...design, colours: design.colours.slice(0, -1) })}
            >
              −
            </button>
          </div>
          <p className="tiny dim">Two or more blend across the word.</p>

          {swatch('Outline', design.outline, (v) => setDesign({ ...design, outline: v }))}
          {swatch('Background', design.background, (v) => setDesign({ ...design, background: v }))}
          {swatch('Tagline', design.taglineColour, (v) => setDesign({ ...design, taglineColour: v }))}

          <label className="row gap-8" style={{ alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={design.transparent}
              onChange={(e) => setDesign({ ...design, transparent: e.target.checked })}
            />
            <span className="tiny">No background — for putting on something else</span>
          </label>

          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>
            Save as PNG
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- firework */

/** The burst, drawn as the game would throw it. */
function FireworkPreview({ design }: { design: FireworkDesign }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const SIZE = 320

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#0a0a14'
    ctx.fillRect(0, 0, SIZE, SIZE)

    const centre = SIZE / 2

    design.bursts.forEach((burst, layer) => {
      const spread = 40 + layer * 14
      const points = burst.shape === 'small_ball' ? 40 : burst.shape === 'large_ball' ? 90 : 60

      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2
        let radius = spread

        /*
         * The shapes are approximated on purpose: what matters at this size is
         * whether the colours work together and roughly how big it is, and a
         * faithful particle simulation would not answer that any better.
         */
        if (burst.shape === 'star') radius = spread * (0.55 + 0.45 * Math.abs(Math.cos(angle * 2.5)))
        else if (burst.shape === 'creeper') radius = spread * (0.6 + 0.4 * Math.abs(Math.sin(angle * 2)))
        else if (burst.shape === 'burst') radius = spread * (0.4 + 0.6 * ((i % 5) / 5))
        else if (burst.shape === 'small_ball') radius = spread * 0.6

        const colour = burst.colours[i % burst.colours.length]
        const x = centre + Math.cos(angle) * radius
        const y = centre + Math.sin(angle) * radius

        if (burst.trail) {
          ctx.fillStyle = colour + '55'
          ctx.fillRect(centre + Math.cos(angle) * radius * 0.55, centre + Math.sin(angle) * radius * 0.55, 2, 2)
        }

        ctx.fillStyle = colour
        ctx.fillRect(x, y, 3, 3)

        if (burst.fades.length) {
          const fade = burst.fades[i % burst.fades.length]
          ctx.fillStyle = fade
          ctx.fillRect(centre + Math.cos(angle) * radius * 1.18, centre + Math.sin(angle) * radius * 1.18, 2, 2)
        }

        if (burst.twinkle && i % 7 === 0) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(x - 1, y - 1, 2, 2)
        }
      }
    })
  }, [design])

  return <canvas ref={ref} width={SIZE} height={SIZE} style={{ borderRadius: 8, maxWidth: '100%' }} />
}

function FireworkSection({
  design,
  setDesign
}: {
  design: FireworkDesign
  setDesign: (d: FireworkDesign) => void
}): JSX.Element {
  const setBurst = (index: number, patch: Partial<FireworkDesign['bursts'][number]>): void =>
    setDesign({
      ...design,
      bursts: design.bursts.map((b, i) => (i === index ? { ...b, ...patch } : b))
    })

  return (
    <div className="row gap-24 items-start wrap">
      <div className="panel panel-pad col gap-12" style={{ flex: '0 1 auto' }}>
        <FireworkPreview design={design} />
        <p className="tiny dim">An impression of the burst, not a simulation.</p>
      </div>

      <div className="col gap-12" style={{ flex: '1 1 340px' }}>
        <div className="panel panel-pad col gap-12">
          <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
            <span className="tiny dim">Flight</span>
            {Array.from({ length: MAX_FLIGHT }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                className={design.flight === n ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => setDesign({ ...design, flight: n })}
              >
                {n}
              </button>
            ))}
            <button
              className="btn btn-sm"
              disabled={design.bursts.length >= 6}
              onClick={() =>
                setDesign({
                  ...design,
                  bursts: [
                    ...design.bursts,
                    { shape: 'small_ball', colours: ['#55FFFF'], fades: [], trail: false, twinkle: true }
                  ]
                })
              }
            >
              Add a burst
            </button>
          </div>

          {design.bursts.map((burst, index) => (
            <div key={index} className="panel panel-pad col gap-8">
              <div className="row gap-8 wrap">
                <select
                  className="input"
                  style={{ flex: 1 }}
                  value={burst.shape}
                  onChange={(e) => setBurst(index, { shape: e.target.value })}
                >
                  {FIREWORK_SHAPES.map((shape) => (
                    <option key={shape} value={shape}>
                      {shape.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
                <button
                  className={burst.trail ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                  onClick={() => setBurst(index, { trail: !burst.trail })}
                >
                  Trail
                </button>
                <button
                  className={burst.twinkle ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                  onClick={() => setBurst(index, { twinkle: !burst.twinkle })}
                >
                  Twinkle
                </button>
                <button
                  className="btn btn-sm"
                  disabled={design.bursts.length <= 1}
                  onClick={() => setDesign({ ...design, bursts: design.bursts.filter((_, i) => i !== index) })}
                >
                  Remove
                </button>
              </div>

              <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                <span className="tiny dim" style={{ width: 44 }}>
                  Colour
                </span>
                {burst.colours.map((colour, at) => (
                  <input
                    key={at}
                    type="color"
                    value={colour}
                    onChange={(e) =>
                      setBurst(index, {
                        colours: burst.colours.map((c, i) => (i === at ? e.target.value : c))
                      })
                    }
                    style={{ width: 30, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                  />
                ))}
                <button
                  className="btn btn-sm"
                  onClick={() => setBurst(index, { colours: [...burst.colours, '#FFFFFF'] })}
                >
                  +
                </button>
                <button
                  className="btn btn-sm"
                  disabled={burst.colours.length <= 1}
                  onClick={() => setBurst(index, { colours: burst.colours.slice(0, -1) })}
                >
                  −
                </button>
              </div>

              <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
                <span className="tiny dim" style={{ width: 44 }}>
                  Fade
                </span>
                {burst.fades.map((colour, at) => (
                  <input
                    key={at}
                    type="color"
                    value={colour}
                    onChange={(e) =>
                      setBurst(index, {
                        fades: burst.fades.map((c, i) => (i === at ? e.target.value : c))
                      })
                    }
                    style={{ width: 30, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                  />
                ))}
                <button className="btn btn-sm" onClick={() => setBurst(index, { fades: [...burst.fades, '#FFFFFF'] })}>
                  +
                </button>
                <button
                  className="btn btn-sm"
                  disabled={burst.fades.length === 0}
                  onClick={() => setBurst(index, { fades: burst.fades.slice(0, -1) })}
                >
                  −
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- item */

function ItemSection({ design, setDesign }: { design: ItemDesign; setDesign: (d: ItemDesign) => void }): JSX.Element {
  const [search, setSearch] = useState('')

  /*
   * Fifteen hundred items is too many for a dropdown, and the id is not always
   * what somebody would type - so both the id and the name the game shows are
   * searched, and the list is capped at what a person will actually scan.
   */
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return ITEMS.slice(0, 40)
    return ITEMS.filter(([id, label]) => id.includes(needle) || label.toLowerCase().includes(needle)).slice(0, 40)
  }, [search])

  const label = ITEMS.find(([id]) => id === design.id)?.[1] ?? design.id

  return (
    <div className="row gap-24 items-start wrap">
      <div className="col gap-12" style={{ flex: '1 1 340px' }}>
        <div className="panel panel-pad col gap-12">
          <div className="section-title">What it is</div>
          <input
            className="input"
            placeholder={`Search 1,505 items — currently ${label}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="row gap-8 wrap" style={{ maxHeight: 180, overflow: 'auto' }}>
            {matches.map(([id, name]) => (
              <button
                key={id}
                className={id === design.id ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => setDesign({ ...design, id })}
                title={id}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="field">
            <label className="field-label">Name</label>
            <input
              className="input"
              placeholder="&6Blade of the Nexus"
              value={design.name}
              onChange={(e) => setDesign({ ...design, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label className="field-label">Lore, one line each</label>
            <textarea
              className="input"
              rows={4}
              value={design.lore.join('\n')}
              onChange={(e) => setDesign({ ...design, lore: e.target.value.split('\n').slice(0, 8) })}
            />
          </div>

          <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
            <span className="tiny dim">How many</span>
            <input
              className="input"
              type="number"
              min={1}
              max={99}
              style={{ width: 80 }}
              value={design.count}
              onChange={(e) => setDesign({ ...design, count: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
            />
            <button
              className={design.unbreakable ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
              onClick={() => setDesign({ ...design, unbreakable: !design.unbreakable })}
            >
              Unbreakable
            </button>
          </div>
        </div>
      </div>

      <div className="col gap-12" style={{ flex: '1 1 340px' }}>
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Enchantments</div>
          <p className="tiny dim">Levels are capped at what the game allows, which is read from the game itself.</p>

          <div style={{ maxHeight: 320, overflow: 'auto' }} className="col gap-8">
            {ENCHANTMENTS.map((ench) => {
              const on = design.enchants.find((e) => e.id === ench.id)
              return (
                <div key={ench.id} className="row gap-8" style={{ alignItems: 'center' }}>
                  <button
                    className={on ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                    style={{ flex: 1, justifyContent: 'flex-start' }}
                    onClick={() =>
                      setDesign({
                        ...design,
                        enchants: on
                          ? design.enchants.filter((e) => e.id !== ench.id)
                          : [...design.enchants, { id: ench.id, level: ench.maxLevel }]
                      })
                    }
                  >
                    {ench.label}
                  </button>
                  {on && (
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={ench.maxLevel}
                      style={{ width: 70 }}
                      value={on.level}
                      onChange={(e) =>
                        setDesign({
                          ...design,
                          enchants: design.enchants.map((x) =>
                            x.id === ench.id
                              ? {
                                  ...x,
                                  level: Math.max(1, Math.min(ench.maxLevel, Number(e.target.value) || 1))
                                }
                              : x
                          )
                        })
                      }
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- recipes */

/** One recipe as a crafting grid, which is how anybody reads a recipe. */
function RecipeCard({ recipe, onRemove }: { recipe: RecipeDesign; onRemove?: () => void }): JSX.Element {
  const label = (id: string): string => ITEMS.find(([i]) => i === id)?.[1] ?? id

  const cell = (item: string | null, at: number): JSX.Element => (
    <div
      key={at}
      title={item ? label(item) : 'empty'}
      className="tiny"
      style={{
        width: 34,
        height: 34,
        borderRadius: 4,
        background: item ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.02)',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        padding: 2,
        textAlign: 'center',
        lineHeight: 1.1
      }}
    >
      {item ? label(item).split(' ')[0].slice(0, 5) : ''}
    </div>
  )

  const grid: (string | null)[] = []
  if (recipe.kind === 'shaped') {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const ch = recipe.pattern[row]?.[col] ?? ' '
        grid.push(ch === ' ' ? null : (recipe.keys[ch] ?? null))
      }
    }
  } else {
    for (let i = 0; i < 9; i++) grid.push(recipe.ingredients[i] ?? null)
  }

  return (
    <div className="panel panel-pad col gap-8" style={{ flex: '0 0 auto' }}>
      <div className="row gap-8" style={{ alignItems: 'center' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 34px)', gap: 3 }}>
          {grid.map((item, at) => cell(item, at))}
        </div>
        <span className="tiny dim">→</span>
        <div className="col gap-4" style={{ textAlign: 'center' }}>
          {cell(recipe.result, 99)}
          <span className="tiny dim">x{recipe.count}</span>
        </div>
      </div>
      <div className="row gap-8" style={{ alignItems: 'center' }}>
        <span className="tiny dim" style={{ flex: 1 }}>
          {recipe.id} · {recipe.kind}
        </span>
        {onRemove && (
          <button className="btn btn-sm" title="Take this one out of the pack" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * What each rule adds, and where it goes.
 *
 * Shown as plain sentences rather than a table because that is how the request
 * was phrased - somebody who asked for emeralds one time in twenty should be
 * able to read back "1 in 20" and see their own words.
 */
function LootCard({ rule, onRemove }: { rule: LootRule; onRemove?: () => void }): JSX.Element {
  const label = (id: string): string => ITEMS.find(([i]) => i === id)?.[1] ?? id

  return (
    <div className="panel panel-pad col gap-8" style={{ flex: '0 0 auto', minWidth: 220 }}>
      <strong className="small">{rule.table}</strong>

      <div className="col gap-4">
        {rule.drops.map((drop, at) => (
          <span key={at} className="tiny">
            {label(drop.item)}
            <span className="dim">
              {drop.min === drop.max ? ` x${drop.min}` : ` x${drop.min}\u2013${drop.max}`}
              {drop.chance >= 1 ? ' every time' : ` \u00b7 1 in ${Math.max(2, Math.round(1 / drop.chance))}`}
            </span>
          </span>
        ))}
      </div>

      <div className="row gap-8" style={{ alignItems: 'center' }}>
        <span className="tiny dim" style={{ flex: 1 }}>
          {rule.id}
        </span>
        {onRemove && (
          <button className="btn btn-sm" title="Take this one out" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function LootSection({
  pack,
  setPack,
  servers,
  busy,
  setBusy,
  onError
}: {
  pack: LootPack
  setPack: (p: LootPack) => void
  servers: HostedServer[]
  busy: boolean
  setBusy: (v: boolean) => void
  onError: (e: LauncherErrorPayload) => void
}): JSX.Element {
  const [targets, setTargets] = useState<InstallTarget[]>([])
  const [targetId, setTargetId] = useState('')

  useEffect(() => {
    void (async () => {
      const found: InstallTarget[] = servers.map((s) => ({
        id: `server:${s.id}`,
        label: `${s.name} (server)`,
        version: s.minecraftVersion,
        kind: 'server',
        serverId: s.id
      }))

      try {
        for (const instance of await api.instances.list()) {
          for (const world of await api.worlds.list(instance.id)) {
            found.push({
              id: `world:${instance.id}:${world.folderName}`,
              label: `${world.name} (${instance.name})`,
              version: instance.minecraftVersion,
              kind: 'world',
              instanceId: instance.id,
              worldFolder: world.folderName
            })
          }
        }
      } catch {
        /* An instance with no saves folder yet is not worth an error. */
      }

      setTargets(found)
      setTargetId((was) => (found.some((t) => t.id === was) ? was : (found[0]?.id ?? '')))
    })()
  }, [servers])

  const target = targets.find((t) => t.id === targetId) ?? null

  // Defensive for the same reason the recipe tab is: a recipe pack opened
  // here has no `rules`.
  const rules = Array.isArray(pack?.rules) ? pack.rules : []

  const install = async (): Promise<void> => {
    if (!target) return
    setBusy(true)
    try {
      if (target.kind === 'server') {
        await api.banners.installLoot(target.serverId as string, pack)
      } else {
        await api.banners.installLootWorld(target.instanceId as string, target.worldFolder as string, pack)
      }
    } catch (err) {
      onError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const chosen = await api.app.pickSavePath({
        title: 'Save the datapack',
        defaultName: `${pack.name.toLowerCase().replace(/[^\w-]+/g, '-') || 'loot'}.zip`,
        extensions: ['zip']
      })
      if (chosen) await api.banners.exportLoot(chosen, pack, target?.version ?? '1.21.1')
    } catch (err) {
      onError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col gap-12">
      <div className="panel panel-pad col gap-12">
        <div className="field">
          <label className="field-label">Pack name</label>
          <input
            className="input"
            value={pack.name}
            onChange={(e) => setPack({ ...pack, name: e.target.value.slice(0, 40) })}
          />
        </div>

        {rules.length === 0 ? (
          <p className="small muted">
            Nothing yet. Say what should drop and how often \u2014 &quot;zombies drop an emerald one time in
            twenty&quot;, say.
          </p>
        ) : (
          <div className="row gap-12 wrap">
            {rules.map((rule) => (
              <LootCard
                key={rule.id}
                rule={rule}
                onRemove={() => setPack({ ...pack, rules: rules.filter((r) => r.id !== rule.id) })}
              />
            ))}
          </div>
        )}
      </div>

      {rules.length > 0 && (
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Put it on the server</div>

          <div className="row gap-8 wrap">
            {targets.length > 0 && (
              <select
                className="input"
                style={{ flex: '1 1 220px' }}
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({t.version})
                  </option>
                ))}
              </select>
            )}
            <button className="btn btn-primary btn-sm" disabled={busy || !target} onClick={() => void install()}>
              {target?.kind === 'world' ? 'Install into that world' : 'Install into the server'}
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => void save()}>
              Save as a .zip
            </button>
          </div>

          <p className="tiny dim">
            The existing drops are kept \u2014 what you asked for is added to the vanilla table rather than replacing
            it. Re-enter the world for it to load.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * One advancement, shown the way the game shows it.
 *
 * The frame matters more than it looks: a challenge is the spiked box that
 * plays a different sound and means something, so it is worth showing which
 * one this will be before it is installed.
 */
function AdvancementCard({ design, onRemove }: { design: AdvancementDesign; onRemove?: () => void }): JSX.Element {
  const label = (id: string): string => ITEMS.find(([i]) => i === id)?.[1] ?? id

  const earned =
    design.trigger === 'kill'
      ? `kill ${design.target.replace(/_/g, ' ')}`
      : design.trigger === 'obtain'
        ? `get ${label(design.target)}`
        : 'granted by command'

  return (
    <div className="panel panel-pad col gap-8" style={{ flex: '0 0 auto', minWidth: 230 }}>
      <div className="row gap-8" style={{ alignItems: 'center' }}>
        <span
          className="tiny"
          style={{
            padding: '2px 6px',
            borderRadius: 4,
            background: 'rgba(255,255,255,0.06)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em'
          }}
        >
          {design.frame}
        </span>
        <strong className="small">{design.title}</strong>
      </div>

      <span className="tiny dim">{design.description}</span>

      <span className="tiny dim">
        {earned}
        {design.experience > 0 ? ` \u00b7 ${design.experience} xp` : ''}
        {design.hidden ? ' \u00b7 hidden' : ''}
      </span>

      <div className="row gap-8" style={{ alignItems: 'center' }}>
        <span className="tiny dim" style={{ flex: 1 }}>
          {label(design.icon)}
        </span>
        {onRemove && (
          <button className="btn btn-sm" title="Take this one out" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function AdvancementSection({
  pack,
  setPack,
  servers,
  busy,
  setBusy,
  onError
}: {
  pack: AdvancementPack
  setPack: (p: AdvancementPack) => void
  servers: HostedServer[]
  busy: boolean
  setBusy: (v: boolean) => void
  onError: (e: LauncherErrorPayload) => void
}): JSX.Element {
  const [targets, setTargets] = useState<InstallTarget[]>([])
  const [targetId, setTargetId] = useState('')

  useEffect(() => {
    void (async () => {
      const found: InstallTarget[] = servers.map((s) => ({
        id: `server:${s.id}`,
        label: `${s.name} (server)`,
        version: s.minecraftVersion,
        kind: 'server',
        serverId: s.id
      }))

      try {
        for (const instance of await api.instances.list()) {
          for (const world of await api.worlds.list(instance.id)) {
            found.push({
              id: `world:${instance.id}:${world.folderName}`,
              label: `${world.name} (${instance.name})`,
              version: instance.minecraftVersion,
              kind: 'world',
              instanceId: instance.id,
              worldFolder: world.folderName
            })
          }
        }
      } catch {
        /* An instance with no saves folder is not worth an error. */
      }

      setTargets(found)
      setTargetId((was) => (found.some((t) => t.id === was) ? was : (found[0]?.id ?? '')))
    })()
  }, [servers])

  const target = targets.find((t) => t.id === targetId) ?? null
  const list = Array.isArray(pack?.advancements) ? pack.advancements : []

  const install = async (): Promise<void> => {
    if (!target) return
    setBusy(true)
    try {
      if (target.kind === 'server') {
        await api.banners.installAdvancements(target.serverId as string, pack)
      } else {
        await api.banners.installAdvancementsWorld(target.instanceId as string, target.worldFolder as string, pack)
      }
    } catch (err) {
      onError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const chosen = await api.app.pickSavePath({
        title: 'Save the datapack',
        defaultName: `${pack.name.toLowerCase().replace(/[^\w-]+/g, '-') || 'advancements'}.zip`,
        extensions: ['zip']
      })
      if (chosen) await api.banners.exportAdvancements(chosen, pack, target?.version ?? '1.21.1')
    } catch (err) {
      onError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col gap-12">
      <div className="panel panel-pad col gap-12">
        <div className="field">
          <label className="field-label">Pack name</label>
          <input
            className="input"
            value={pack.name}
            onChange={(e) => setPack({ ...pack, name: e.target.value.slice(0, 40) })}
          />
        </div>

        {list.length === 0 ? (
          <p className="small muted">
            Nothing yet. Say what players should be aiming for \u2014 &quot;a few goals for a new survival player&quot;,
            say.
          </p>
        ) : (
          <div className="row gap-12 wrap">
            {list.map((design) => (
              <AdvancementCard
                key={design.id}
                design={design}
                onRemove={() =>
                  setPack({
                    ...pack,
                    advancements: list.filter((a) => a.id !== design.id)
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {list.length > 0 && (
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Put it on the server</div>

          <div className="row gap-8 wrap">
            {targets.length > 0 && (
              <select
                className="input"
                style={{ flex: '1 1 220px' }}
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({t.version})
                  </option>
                ))}
              </select>
            )}
            <button className="btn btn-primary btn-sm" disabled={busy || !target} onClick={() => void install()}>
              {target?.kind === 'world' ? 'Install into that world' : 'Install into the server'}
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => void save()}>
              Save as a .zip
            </button>
          </div>

          <p className="tiny dim">
            They appear as their own tab in the advancements screen. Ones marked &quot;granted by command&quot; are
            earned with /advancement grant, which is how a plugin awards them.
          </p>
        </div>
      )}
    </div>
  )
}

/** Somewhere a pack can be installed: a hosted server, or one save. */
interface InstallTarget {
  id: string
  label: string
  version: string
  kind: 'server' | 'world'
  serverId?: string
  instanceId?: string
  worldFolder?: string
}

function RecipeSection({
  pack,
  setPack,
  servers,
  serverId,
  setServerId,
  busy,
  setBusy,
  onError
}: {
  pack: RecipePack
  setPack: (p: RecipePack) => void
  servers: HostedServer[]
  serverId: string
  setServerId: (id: string) => void
  busy: boolean
  setBusy: (v: boolean) => void
  onError: (e: LauncherErrorPayload) => void
}): JSX.Element {
  const server = servers.find((s) => s.id === serverId) ?? null

  /*
   * Every world a pack could go into, servers and singleplayer alike.
   *
   * Only hosted servers were offered before. Somebody playing singleplayer had
   * one entry in the list, it was a server with a similar name, and installing
   * to it looked exactly like success - the pack was written, to a world they
   * were not in.
   */
  const [targets, setTargets] = useState<InstallTarget[]>([])
  const [targetId, setTargetId] = useState('')

  useEffect(() => {
    void (async () => {
      const found: InstallTarget[] = servers.map((s) => ({
        id: `server:${s.id}`,
        label: `${s.name} (server)`,
        version: s.minecraftVersion,
        kind: 'server',
        serverId: s.id
      }))

      try {
        for (const instance of await api.instances.list()) {
          for (const world of await api.worlds.list(instance.id)) {
            found.push({
              id: `world:${instance.id}:${world.folderName}`,
              label: `${world.name} (${instance.name})`,
              version: instance.minecraftVersion,
              kind: 'world',
              instanceId: instance.id,
              worldFolder: world.folderName
            })
          }
        }
      } catch {
        /* An instance with no saves folder yet is not an error worth showing. */
      }

      setTargets(found)
      setTargetId((was) => (found.some((t) => t.id === was) ? was : (found[0]?.id ?? '')))
    })()
  }, [servers])

  const target = targets.find((t) => t.id === targetId) ?? null

  /*
   * Read defensively, because a saved design is whatever was stored.
   *
   * A loot pack opened here has `rules` and no `recipes`, and reading
   * `.length` off the missing one crashed the whole interface rather than
   * showing an empty tab.
   */
  const recipes = Array.isArray(pack?.recipes) ? pack.recipes : []

  const install = async (): Promise<void> => {
    if (!target) return
    setBusy(true)
    try {
      if (target.kind === 'server') {
        await api.banners.installRecipes(target.serverId as string, pack)
        setServerId(target.serverId as string)
      } else {
        await api.banners.installRecipesWorld(target.instanceId as string, target.worldFolder as string, pack)
      }
    } catch (err) {
      onError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const chosen = await api.app.pickSavePath({
        title: 'Save the datapack',
        defaultName: `${pack.name.toLowerCase().replace(/[^\w-]+/g, '-') || 'recipes'}.zip`,
        extensions: ['zip']
      })
      if (chosen) {
        await api.banners.exportRecipes(chosen, pack, target?.version ?? server?.minecraftVersion ?? '1.21.1')
      }
    } catch (err) {
      onError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col gap-12">
      <div className="panel panel-pad col gap-12">
        <div className="field">
          <label className="field-label">Pack name</label>
          <input
            className="input"
            value={pack.name}
            onChange={(e) => setPack({ ...pack, name: e.target.value.slice(0, 40) })}
          />
        </div>

        {recipes.length === 0 ? (
          <p className="small muted">
            Nothing yet. Describe the recipes you want above — &quot;turn cobblestone back into ore&quot;, say, or
            &quot;a cheaper way to make saddles&quot;.
          </p>
        ) : (
          <div className="row gap-12 wrap">
            {recipes.map((recipe) => (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                onRemove={() =>
                  setPack({
                    ...pack,
                    recipes: recipes.filter((r) => r.id !== recipe.id)
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      {recipes.length > 0 && (
        <div className="panel panel-pad col gap-12">
          <div className="section-title">Put it on the server</div>

          <div className="row gap-8 wrap">
            {targets.length > 0 && (
              <select
                className="input"
                style={{ flex: '1 1 220px' }}
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({t.version})
                  </option>
                ))}
              </select>
            )}
            <button className="btn btn-primary btn-sm" disabled={busy || !target} onClick={() => void install()}>
              {target?.kind === 'world' ? 'Install into that world' : 'Install into the server'}
            </button>
            <button className="btn btn-sm" disabled={busy} onClick={() => void save()}>
              Save as a .zip
            </button>
          </div>

          <p className="tiny dim">
            {target?.kind === 'world'
              ? 'Written into that save\u2019s datapacks folder. Leave the world and come back for the recipes to load.'
              : 'Written into the server world\u2019s datapacks folder. A running server is reloaded so the recipes work straight away.'}
          </p>
        </div>
      )}
    </div>
  )
}
