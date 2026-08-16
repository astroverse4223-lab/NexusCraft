/** Shapes of Mojang's version metadata, as far as the launcher consumes them. */

export interface DownloadInfo {
  url: string
  sha1: string
  size: number
  path?: string
  id?: string
  totalSize?: number
}

export interface RuleOsSpec {
  name?: string
  version?: string
  arch?: string
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: RuleOsSpec
  features?: Record<string, boolean>
}

export interface Library {
  name: string
  downloads?: {
    artifact?: DownloadInfo
    classifiers?: Record<string, DownloadInfo>
  }
  /** Legacy natives mapping, e.g. { windows: "natives-windows" }. */
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  rules?: Rule[]
  /** Present on Forge/Fabric libraries served from a plain maven repo. */
  url?: string
}

export type ArgumentEntry = string | { rules?: Rule[]; value: string | string[] }

export interface VersionJson {
  id: string
  /** Set on loader profiles: the vanilla version whose json this one extends. */
  inheritsFrom?: string
  /**
   * Added by `resolveVersion`: the id of the vanilla version at the root of the
   * inheritance chain. The client jar and asset index live under that id, not
   * under the loader profile's id.
   */
  resolvedBaseId?: string
  type: string
  mainClass: string
  assets?: string
  assetIndex?: DownloadInfo & { id: string; totalSize: number }
  downloads?: Record<string, DownloadInfo>
  libraries?: Library[]
  arguments?: {
    game?: ArgumentEntry[]
    jvm?: ArgumentEntry[]
  }
  /** Pre-1.13 single-string argument template. */
  minecraftArguments?: string
  javaVersion?: { component: string; majorVersion: number }
  logging?: {
    client?: {
      argument: string
      file: DownloadInfo & { id: string }
      type: string
    }
  }
  releaseTime?: string
  time?: string
  minimumLauncherVersion?: number
  complianceLevel?: number
}

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
  /** Older versions map asset names to real file paths under resources/. */
  virtual?: boolean
  map_to_resources?: boolean
}

export interface VersionManifest {
  latest: { release: string; snapshot: string }
  versions: Array<{
    id: string
    type: string
    url: string
    time: string
    releaseTime: string
    sha1: string
    complianceLevel: number
  }>
}
