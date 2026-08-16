import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { dataRoot, dbFile } from './paths'
import { createLogger } from './logger'

const log = createLogger('db')

/**
 * A tiny document store. SQLite is the real backend; the JSON backend is a
 * fallback so that a machine that cannot load the native module still gets a
 * fully working launcher rather than a startup crash.
 */
export interface Store {
  all<T>(collection: string): T[]
  get<T>(collection: string, id: string): T | null
  put<T extends object>(collection: string, id: string, doc: T): void
  remove(collection: string, id: string): void
  clear(collection: string): void
  kvGet(key: string): string | null
  kvSet(key: string, value: string): void
  kvRemove(key: string): void
  readonly backend: 'sqlite' | 'json'
  close(): void
}

class SqliteStore implements Store {
  readonly backend = 'sqlite' as const
  // Typed loosely: better-sqlite3 is an optional dependency and may be absent.
  private db: any

  constructor(Database: any, file: string) {
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        collection TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
      CREATE TABLE IF NOT EXISTS kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  all<T>(collection: string): T[] {
    const rows = this.db.prepare('SELECT data FROM documents WHERE collection = ?').all(collection) as {
      data: string
    }[]
    const out: T[] = []
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.data) as T)
      } catch {
        log.warn(`skipping unparseable document in ${collection}`)
      }
    }
    return out
  }

  get<T>(collection: string, id: string): T | null {
    const row = this.db.prepare('SELECT data FROM documents WHERE collection = ? AND id = ?').get(collection, id) as
      | { data: string }
      | undefined
    if (!row) return null
    try {
      return JSON.parse(row.data) as T
    } catch {
      return null
    }
  }

  put<T extends object>(collection: string, id: string, doc: T): void {
    this.db
      .prepare(
        `INSERT INTO documents (collection, id, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      )
      .run(collection, id, JSON.stringify(doc), Date.now())
  }

  remove(collection: string, id: string): void {
    this.db.prepare('DELETE FROM documents WHERE collection = ? AND id = ?').run(collection, id)
  }

  clear(collection: string): void {
    this.db.prepare('DELETE FROM documents WHERE collection = ?').run(collection)
  }

  kvGet(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    return row ? row.value : null
  }

  kvSet(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  kvRemove(key: string): void {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key)
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      /* already closed */
    }
  }
}

interface JsonShape {
  documents: Record<string, Record<string, unknown>>
  kv: Record<string, string>
}

class JsonStore implements Store {
  readonly backend = 'json' as const
  private data: JsonShape = { documents: {}, kv: {} }
  private writeTimer: NodeJS.Timeout | null = null

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as JsonShape
        this.data = { documents: parsed.documents ?? {}, kv: parsed.kv ?? {} }
      } catch {
        log.warn('json store was unreadable; starting from empty state')
      }
    }
  }

  /** Debounced so a burst of writes costs one flush, then written atomically. */
  private scheduleFlush(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      this.flush()
    }, 120)
  }

  private flush(): void {
    try {
      const tmp = this.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      log.error('failed to persist json store', err)
    }
  }

  all<T>(collection: string): T[] {
    return Object.values(this.data.documents[collection] ?? {}) as T[]
  }

  get<T>(collection: string, id: string): T | null {
    return ((this.data.documents[collection] ?? {})[id] as T) ?? null
  }

  put<T extends object>(collection: string, id: string, doc: T): void {
    this.data.documents[collection] ??= {}
    this.data.documents[collection][id] = doc
    this.scheduleFlush()
  }

  remove(collection: string, id: string): void {
    delete this.data.documents[collection]?.[id]
    this.scheduleFlush()
  }

  clear(collection: string): void {
    this.data.documents[collection] = {}
    this.scheduleFlush()
  }

  kvGet(key: string): string | null {
    return this.data.kv[key] ?? null
  }

  kvSet(key: string, value: string): void {
    this.data.kv[key] = value
    this.scheduleFlush()
  }

  kvRemove(key: string): void {
    delete this.data.kv[key]
    this.scheduleFlush()
  }

  close(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer)
    this.writeTimer = null
    this.flush()
  }
}

export const Collections = {
  accounts: 'accounts',
  instances: 'instances',
  servers: 'servers',
  skins: 'skins',
  javaRuntimes: 'java_runtimes'
} as const

/**
 * better-sqlite3 is a compiled native module. When its binary does not match the
 * Electron runtime it does not throw — it aborts the process with an access
 * violation, which no try/catch can intercept.
 *
 * So the module is loaded in a throwaway child process first. If that child
 * survives, loading it in-process is safe; if it crashes, only the child dies
 * and the launcher quietly uses the JSON backend instead. The verdict is cached
 * per runtime so this costs one spawn per install, not one per start.
 */
const PROBE_MARKER = 'NEXUSCRAFT_SQLITE_OK'

function probeCacheFile(): string {
  return join(dataRoot(), '.native-probe.json')
}

function sqliteIsLoadable(): boolean {
  let modulePath: string
  try {
    modulePath = require.resolve('better-sqlite3')
  } catch {
    log.warn('better-sqlite3 is not installed')
    return false
  }

  const key = `${process.versions.electron ?? 'node'}|${process.versions.modules}|${modulePath}`

  try {
    const cached = JSON.parse(readFileSync(probeCacheFile(), 'utf8')) as { key?: string; ok?: boolean }
    if (cached.key === key && typeof cached.ok === 'boolean') return cached.ok
  } catch {
    /* no usable cache yet */
  }

  // ELECTRON_RUN_AS_NODE gives the child the same Node/V8 ABI as the main
  // process without starting a second Chromium.
  const script = `const D=require(${JSON.stringify(modulePath)});const d=new D(':memory:');d.exec('CREATE TABLE probe(a)');d.close();console.log(${JSON.stringify(PROBE_MARKER)})`
  const env: Record<string, string | undefined> = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  // NODE_OPTIONS from the parent environment can inject flags the probe does
  // not expect, so it is dropped rather than inherited.
  delete env.NODE_OPTIONS

  let ok = false
  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      env,
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true
    })
    ok = result.status === 0 && (result.stdout ?? '').includes(PROBE_MARKER)
    if (!ok) {
      log.warn(
        `better-sqlite3 failed to load (exit ${result.status ?? 'signal ' + result.signal}); using the JSON backend instead`
      )
    }
  } catch (err) {
    log.warn('could not probe better-sqlite3:', (err as Error).message)
    ok = false
  }

  try {
    writeFileSync(probeCacheFile(), JSON.stringify({ key, ok }), 'utf8')
  } catch {
    /* the probe just runs again next start */
  }
  return ok
}

let store: Store | null = null

export function initDatabase(): Store {
  if (store) return store

  if (sqliteIsLoadable()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3')
      store = new SqliteStore(Database, dbFile())
      log.info('using the sqlite backend')
      return store
    } catch (err) {
      log.warn('sqlite passed its probe but failed to open:', (err as Error).message)
    }
  }

  store = new JsonStore(join(dataRoot(), 'nexuscraft-data.json'))
  log.info('using the json backend')
  return store
}

export function db(): Store {
  if (!store) throw new Error('database not initialised')
  return store
}

export function closeDatabase(): void {
  store?.close()
  store = null
}
