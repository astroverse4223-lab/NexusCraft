/**
 * A bot that joins the server so I can see the lobby and place things in it.
 *
 * Everything about setting the lobby up needs a player: `/nexus setnpc` reads
 * where you are standing, and the console has no position. That leaves the
 * whole job to somebody clicking blocks by hand, and it is the part of building
 * this server that is genuinely tedious.
 *
 * A mineflayer bot is a player as far as the server is concerned. It can walk
 * to a coordinate, run a command from there, and — the part that matters more —
 * read the blocks around it, which is the only way for me to know what the
 * lobby actually looks like rather than guessing at somebody else's build.
 *
 * Needs `online-mode=false` on the server, because it has no Minecraft account.
 * That is a setting to turn back on before anybody else connects.
 *
 *   node lobbybot.cjs survey [radius]     draw the floor around spawn
 *   node lobbybot.cjs probe <x> <z>       what is at this column
 *   node lobbybot.cjs cmd "<command>"     run one command as a player
 *   node lobbybot.cjs place <id> <x> <y> <z>
 */

const path = require('path')
const mineflayer = require(path.join(__dirname, '..', '..', 'node_modules', 'mineflayer'))

const HOST = process.env.NEXUS_HOST || '127.0.0.1'
const PORT = Number(process.env.NEXUS_PORT || 25566)
const NAME = process.env.NEXUS_BOT || 'Surveyor'
const VERSION = false

/** How long to wait for chunks after spawning, before reading blocks. */
const SETTLE_MS = 4000

/**
 * What each block is drawn as.
 *
 * Chosen so the shape of a build survives being flattened to text: solid ground
 * is dense, air is blank, and anything you could walk through but not stand on
 * is faint. Reading a lobby off this is the whole point, so the symbols matter
 * more than they look like they should.
 */
function symbolFor(name) {
  if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') return ' '
  if (name === 'water') return '~'
  if (name === 'lava') return '!'
  if (name.includes('leaves')) return '*'
  if (name.includes('log') || name.includes('stem')) return 'T'
  if (name.includes('glass')) return 'o'
  if (name.includes('stairs')) return '/'
  if (name.includes('slab')) return '_'
  if (name.includes('wall') || name.includes('fence')) return '|'
  if (name.includes('grass') || name.includes('moss')) return ','
  if (name.includes('sand')) return ':'
  if (name.includes('quartz') || name.includes('white')) return '#'
  if (name.includes('deepslate') || name.includes('black')) return '%'
  if (name.includes('gold')) return '$'
  if (name.includes('stone') || name.includes('brick') || name.includes('andesite')) return '='
  return '+'
}

function connect() {
  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({
      host: HOST,
      port: PORT,
      username: NAME,
      auth: 'offline',
      version: VERSION,
      hideErrors: false
    })

    const failed = (why) => reject(new Error(String(why)))

    bot.once('spawn', () => {
      // Chunks arrive after the spawn packet, so reading blocks immediately
      // gives a world made entirely of air.
      setTimeout(() => resolve(bot), SETTLE_MS)
    })

    bot.once('kicked', failed)
    bot.once('error', failed)
    bot.once('end', (why) => failed('disconnected: ' + why))
  })
}

/**
 * Draws the highest solid block in each column, as a map.
 *
 * Highest rather than at-the-bot's-level because a lobby is a building — the
 * useful picture is the roofline and the plaza, not a slice through whatever
 * height the bot happens to be standing at.
 */
async function survey(bot, radius) {
  const at = bot.entity.position
  const cx = Math.floor(at.x)
  const cz = Math.floor(at.z)
  const cy = Math.floor(at.y)

  console.log(`world: ${bot.game.levelType ?? '?'}   dimension: ${bot.game.dimension}`)
  console.log(`bot at: ${cx} ${cy} ${cz}`)
  console.log(`legend: = stone  # quartz  % dark  $ gold  T log  * leaves  o glass  , grass  ~ water  | wall  / stairs  _ slab  . floor level`)
  console.log('')

  const rows = []
  for (let dz = -radius; dz <= radius; dz++) {
    let row = ''
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx
      const z = cz + dz

      let drawn = ' '
      // Search down from a little above the bot, so towers do not hide the
      // plaza and the plaza is found before the bedrock under it.
      for (let y = cy + 20; y >= cy - 20; y--) {
        const block = bot.blockAt(new (require(path.join(__dirname, '..', '..', 'node_modules', 'vec3')).Vec3)(x, y, z))
        if (!block) continue
        if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') continue

        drawn = symbolFor(block.name)
        // Mark the level the bot is standing on, so scale is readable.
        if (y === cy - 1) drawn = drawn === ' ' ? '.' : drawn
        break
      }

      if (dx === 0 && dz === 0) drawn = '@'
      row += drawn
    }
    rows.push(row)
  }

  for (const row of rows) console.log(row)
  console.log('')
  console.log(`(${radius * 2 + 1} blocks across, centred on the bot)`)
}

/** What is stacked at one column, for looking at a specific spot closely. */
async function probe(bot, x, z) {
  const { Vec3 } = require(path.join(__dirname, '..', '..', 'node_modules', 'vec3'))
  const cy = Math.floor(bot.entity.position.y)

  console.log(`column ${x}, ${z}:`)
  for (let y = cy + 12; y >= cy - 12; y--) {
    const block = bot.blockAt(new Vec3(x, y, z))
    if (!block || block.name === 'air') continue
    console.log(`  y=${y}  ${block.name}`)
  }
}

function say(bot, line) {
  return new Promise((resolve) => {
    bot.chat(line)
    setTimeout(resolve, 600)
  })
}

async function main() {
  const [action, ...rest] = process.argv.slice(2)

  const bot = await connect()
  console.log(`joined as ${NAME}`)

  try {
    if (action === 'survey') {
      await survey(bot, Number(rest[0] || 30))
    } else if (action === 'probe') {
      await probe(bot, Number(rest[0]), Number(rest[1]))
    } else if (action === 'cmd') {
      await say(bot, rest.join(' '))
      console.log('sent')
    } else if (action === 'place') {
      const [id, x, y, z] = rest
      // Teleported rather than walked: pathfinding across a decorative build
      // is slow and can fail, and the command only cares where the bot is.
      await say(bot, `/tp ${NAME} ${x} ${y} ${z}`)
      await say(bot, `/nexus setnpc ${id}`)
      console.log(`placed ${id} at ${x} ${y} ${z}`)
    } else {
      console.log('survey [radius] | probe <x> <z> | cmd "<command>" | place <id> <x> <y> <z>')
    }
  } finally {
    // A second, so anything sent has actually left before the socket closes.
    setTimeout(() => bot.quit(), 1000)
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
