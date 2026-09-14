/**
 * Serves the built site, for hosts that run a process rather than files.
 *
 * GitHub Pages takes the folder as it is. Railway runs a container and waits
 * for something to answer on a port, so this is that something.
 *
 * No dependencies on purpose. The whole site is one html file and two
 * pictures, and a framework to hand over three files is a supply chain to
 * maintain for nothing.
 *
 * It does not build anything. The build reads textures out of a Minecraft jar
 * that exists on the machine the pack was made on and nowhere else, so what
 * gets deployed is the output, already built.
 */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, 'public')
const PORT = Number(process.env.PORT) || 8080

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
}

/**
 * The file a url is asking for, or nothing if it is asking for somewhere else.
 *
 * Resolved and then checked to be inside the root rather than pattern-matched
 * for "..", because encodings of that abound and there is only one question
 * worth asking: is the path this resolved to underneath the folder being
 * served.
 */
function resolve(url) {
  let name
  try {
    name = decodeURIComponent(new URL(url, 'http://x').pathname)
  } catch {
    return null
  }

  if (name.endsWith('/')) name += 'index.html'

  const file = path.resolve(ROOT, '.' + name)
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return null

  return file
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end()
    return
  }

  const file = resolve(request.url || '/')

  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }

  const extension = path.extname(file).toLowerCase()
  const stat = fs.statSync(file)

  /*
   * The page is checked every time and the pictures are not. The html is
   * where the address and the vote links live, so a stale copy of it is a
   * player typing an address that has moved; the artwork never changes
   * without its name changing.
   */
  const cache = extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'

  response.writeHead(200, {
    'content-type': TYPES[extension] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': cache,
    'x-content-type-options': 'nosniff'
  })

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  fs.createReadStream(file).pipe(response)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`serving ${ROOT} on ${PORT}`)
})
