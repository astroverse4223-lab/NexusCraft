/**
 * Builds the server's public page into one file.
 *
 * One file on purpose. The page is going on GitHub Pages behind a domain,
 * where every extra request is another thing that can be slow, blocked or
 * cached wrong - and the whole site is 16 kilobytes of textures and some
 * markup, which is smaller than the average hero image.
 *
 * The textures are lifted out of the game's own jar rather than drawn to
 * look like it. That is the entire visual idea: real dirt, real grass, the
 * real greyscale grass mask multiplied by the tint the game uses.
 *
 *   node website/build.cjs
 */
const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')
const { PNG } = require('pngjs')

const HERE = __dirname
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, 'site.json'), 'utf8'))

/*
 * The three tints the game applies, and only to the textures listed below.
 *
 * Named per texture rather than detected, because the obvious test - is this
 * file grey? - says yes to stone, cobblestone and bedrock, which are grey
 * because stone is grey. Tinting those turns the island green.
 */
const GRASS = [0x91, 0xbd, 0x59]
const FOLIAGE = [0x77, 0xab, 0x2f]
const WATER = [0x3f, 0x76, 0xe4]

/** Which of the island's textures are masks, and what colours them. */
const TINTED = {
  grass_block_top: GRASS,
  oak_leaves: FOLIAGE,
  short_grass: FOLIAGE,
  water_still: WATER
}

/** Blocks the island is made of, beyond the ones the page already uses. */
const ISLAND_BLOCKS = [
  'oak_leaves', 'oak_log', 'oak_log_top', 'oak_planks',
  'water_still', 'lava_still', 'dandelion', 'short_grass'
]

const BLOCKS = [
  'grass_block_side', 'grass_block_top', 'dirt', 'stone', 'deepslate',
  'cobblestone', 'oak_planks', 'stone_bricks', 'end_stone', 'obsidian',
  'diamond_block', 'emerald_block', 'gold_block', 'netherrack', 'bedrock',
  'crafting_table_front', 'bookshelf', 'nether_bricks', 'purpur_block',
  'sea_lantern', 'redstone_block', 'iron_block', 'quartz_block_side',
  'amethyst_block', 'sculk', 'prismarine_bricks'
]

const ITEMS = [
  'diamond_sword', 'iron_pickaxe', 'emerald', 'golden_apple', 'ender_pearl',
  'diamond', 'nether_star', 'totem_of_undying', 'elytra', 'trident',
  'experience_bottle', 'firework_rocket'
]

function textures() {
  if (!fs.existsSync(CONFIG.jar)) {
    throw new Error(
      `No Minecraft jar at ${CONFIG.jar}.\n` +
        'Point "jar" in website/site.json at a downloaded version, then build again.'
    )
  }

  const zip = new AdmZip(CONFIG.jar)
  const out = {}
  const missing = []

  const read = (entryPath, tint) => {
    const entry = zip.getEntry(entryPath)
    if (!entry) return null

    const png = PNG.sync.read(entry.getData())

    /*
     * A square off the top, which for a still texture is the whole file and
     * for an animated one is the first frame. Water and lava are stored as
     * tall strips of frames, and taking the file whole squashes twenty of
     * them into one square of soup.
     */
    const side = Math.min(png.width, png.height)
    const square = png.height === side && png.width === side && !tint

    if (square) return 'data:image/png;base64,' + entry.getData().toString('base64')

    const out = new PNG({ width: side, height: side })

    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const i = (png.width * y + x) << 2
        const o = (side * y + x) << 2
        out.data[o] = tint ? Math.round((png.data[i] * tint[0]) / 255) : png.data[i]
        out.data[o + 1] = tint ? Math.round((png.data[i + 1] * tint[1]) / 255) : png.data[i + 1]
        out.data[o + 2] = tint ? Math.round((png.data[i + 2] * tint[2]) / 255) : png.data[i + 2]
        out.data[o + 3] = png.data[i + 3]
      }
    }

    return 'data:image/png;base64,' + PNG.sync.write(out).toString('base64')
  }

  for (const name of [...BLOCKS, ...ISLAND_BLOCKS]) {
    const url = read(`assets/minecraft/textures/block/${name}.png`, TINTED[name] || null)
    if (url) out['block/' + name] = url
    else missing.push('block/' + name)
  }

  for (const name of ITEMS) {
    const url = read(`assets/minecraft/textures/item/${name}.png`)
    if (url) out['item/' + name] = url
    else missing.push('item/' + name)
  }

  return { out, missing }
}

/**
 * The skyblock starting island, as the plugin actually stores it.
 *
 * Real block data off the server rather than something drawn to look like a
 * build. It is the island every skyblock player wakes up on, which makes it
 * the one build on the server that every visitor will eventually stand on.
 *
 * Only the server's own content goes on the page. The lobby world is a
 * purchased build whose licence does not allow passing it on, so its geometry
 * stays off the public site however good it looks.
 */
function island() {
  if (!CONFIG.island || !fs.existsSync(CONFIG.island)) return null

  const yaml = require('yaml')
  const parsed = yaml.parse(fs.readFileSync(CONFIG.island, 'utf8'))
  const blocks = (parsed && parsed.blocks) || {}

  /* Anything with no cube to draw. A sign is an entity model, not a block. */
  const SKIP = new Set(['air', 'oak_sign', 'oak_wall_sign', 'cave_air', 'void_air'])

  const out = []
  let low = [Infinity, Infinity, Infinity]
  let high = [-Infinity, -Infinity, -Infinity]

  for (const key of Object.keys(blocks)) {
    const at = key.split('_').map(Number)
    if (at.length !== 3 || at.some(Number.isNaN)) continue

    const raw = String((blocks[key] || {}).data || '')
    const id = raw.replace(/^minecraft:/, '').replace(/\[.*$/, '')
    if (!id || SKIP.has(id)) continue

    /* Logs are drawn with their rings on whichever pair of faces the axis
       names, so the one piece of state worth keeping is kept. */
    const axis = /axis=([xyz])/.exec(raw)

    out.push([at[0], at[1], at[2], id, axis ? axis[1] : 'y'])

    for (let i = 0; i < 3; i++) {
      low[i] = Math.min(low[i], at[i])
      high[i] = Math.max(high[i], at[i])
    }
  }

  if (!out.length) return null

  /* Moved to sit around its own origin, so the page can spin it about the
     middle without knowing where on the server it used to be. */
  const middle = [
    Math.round((low[0] + high[0]) / 2),
    low[1],
    Math.round((low[2] + high[2]) / 2)
  ]

  return {
    blocks: out.map(([x, y, z, id, axis]) => [x - middle[0], y - middle[1], z - middle[2], id, axis]),
    size: [high[0] - low[0] + 1, high[1] - low[1] + 1, high[2] - low[2] + 1]
  }
}

/** Anything going into markup, so a server name with an ampersand cannot break the page. */
function escape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function main() {
  const { out: tex, missing } = textures()
  const built = island()

  /*
   * The first word of the name in the grass green.
   *
   * Only the first: colouring the whole thing makes a green rectangle, and
   * colouring nothing makes a heading that could belong to any server.
   */
  const words = String(CONFIG.title).trim().split(/\s+/)
  const titleHtml =
    words.length > 1
      ? `<span class="green">${escape(words[0])}</span> ${escape(words.slice(1).join(' '))}`
      : `<span class="green">${escape(words[0] || 'Server')}</span>`

  const cssVars = Object.entries(tex)
    .filter(([key]) => key.startsWith('block/'))
    .map(([key, url]) => `--tex-${key.slice('block/'.length)}: url(${url});`)
    .join('\n  ')

  let html = fs.readFileSync(path.join(HERE, 'template.html'), 'utf8')

  const swaps = {
    __TITLE__: escape(CONFIG.title),
    __TITLE_HTML__: titleHtml,
    __BLURB__: escape(CONFIG.blurb),
    __ADDRESS__: escape(CONFIG.address),
    __VERSION__: escape(CONFIG.version),
    __MODES_LEDE__: escape(CONFIG.modesLede),
    __VOTE_REWARD__: escape(CONFIG.voteReward),
    __TEX_ITEM_GRASS__: tex['item/emerald'] || '',
    __TEXVARS__: cssVars,
    __TEXJSON__: JSON.stringify(tex),
    __CONFIG__: JSON.stringify({
      address: CONFIG.address,
      modes: CONFIG.modes,
      votes: CONFIG.votes,
      facts: CONFIG.facts || [],
      island: built
    })
  }

  for (const [token, value] of Object.entries(swaps)) {
    html = html.split(token).join(value)
  }

  const left = html.match(/__[A-Z_]+__/g)
  if (left) throw new Error('template still has placeholders: ' + [...new Set(left)].join(', '))

  const dist = path.join(HERE, 'public')
  fs.mkdirSync(dist, { recursive: true })
  fs.writeFileSync(path.join(dist, 'index.html'), html)

  /*
   * A CNAME file is how GitHub Pages is told which domain is its own. Without
   * it Pages answers the custom domain with someone else's 404.
   */
  if (CONFIG.domain) fs.writeFileSync(path.join(dist, 'CNAME'), CONFIG.domain + '\n')

  // Pages runs Jekyll unless told not to, which silently eats files that
  // start with an underscore. Nothing here does yet, and one empty file is
  // cheaper than working out why an asset vanished later.
  fs.writeFileSync(path.join(dist, '.nojekyll'), '')

  /*
   * The hero artwork, which is the one thing too big to inline. Everything
   * else on the page is a 16-pixel texture; this is a real picture, and a
   * third of a megabyte of base64 in the markup would hold up the text.
   */
  const art = path.join(HERE, 'art')
  if (fs.existsSync(art)) {
    const into = path.join(dist, 'art')
    fs.mkdirSync(into, { recursive: true })
    for (const file of fs.readdirSync(art)) {
      fs.copyFileSync(path.join(art, file), path.join(into, file))
    }
    console.log(`copied ${fs.readdirSync(art).length} artwork file(s)`)
  }

  const size = fs.statSync(path.join(dist, 'index.html')).size
  console.log(`built website/public/index.html - ${(size / 1024).toFixed(0)} KB, ${Object.keys(tex).length} textures`)
  if (CONFIG.domain) console.log(`CNAME set to ${CONFIG.domain}`)
  if (built) console.log(`island: ${built.blocks.length} blocks, ${built.size.join(' x ')}`)
  else console.log('no island data - point "island" in site.json at islandtemplate.yml')
  if (missing.length) console.log('not in this jar: ' + missing.join(', '))
}

main()
