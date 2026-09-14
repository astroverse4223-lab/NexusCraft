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

/** The tint the game multiplies grass by in a plains biome. */
const GRASS = [0x91, 0xbd, 0x59]

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
    if (!tint) return 'data:image/png;base64,' + entry.getData().toString('base64')

    const png = PNG.sync.read(entry.getData())

    /*
     * Only the first frame. Animated textures stack their frames down one
     * tall strip, and taking the whole file squashes the lot into a square.
     */
    const side = Math.min(png.width, png.height)
    const tinted = new PNG({ width: side, height: side })

    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const i = (png.width * y + x) << 2
        const o = (side * y + x) << 2
        tinted.data[o] = Math.round((png.data[i] * tint[0]) / 255)
        tinted.data[o + 1] = Math.round((png.data[i + 1] * tint[1]) / 255)
        tinted.data[o + 2] = Math.round((png.data[i + 2] * tint[2]) / 255)
        tinted.data[o + 3] = png.data[i + 3]
      }
    }

    return 'data:image/png;base64,' + PNG.sync.write(tinted).toString('base64')
  }

  for (const name of BLOCKS) {
    const url = read(
      `assets/minecraft/textures/block/${name}.png`,
      name === 'grass_block_top' ? GRASS : null
    )
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
      facts: CONFIG.facts || []
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
  if (missing.length) console.log('not in this jar: ' + missing.join(', '))
}

main()
