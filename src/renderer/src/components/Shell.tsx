import { Minus, Square, X, Copy } from 'lucide-react'
import {
  Home,
  Play,
  Boxes,
  Package,
  Server,
  Globe2,
  Shirt,
  Settings as SettingsIcon,
  UserCircle2,
  Layers,
  Bot,
  HardDrive
} from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { Logo } from './Logo'
import { SkinFace } from './SkinView'
import { useStore, activeAccount, type Route } from '../store/useStore'

/* -------------------------------------------------------------- titlebar */

export function TitleBar(): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const launches = useStore((s) => s.launches)
  const running = Object.values(launches).filter((l) => l.stage === 'running').length

  return (
    <div className="titlebar">
      <Logo size={17} glow={false} />
      <span className="titlebar-title">NEXUSCRAFT LAUNCHER</span>

      {running > 0 && (
        <span className="pill success" style={{ marginLeft: 6 }}>
          <span className="dot online" />
          {running} game{running === 1 ? '' : 's'} running
        </span>
      )}

      <div className="spacer" />

      <div className="window-controls">
        <button className="window-control" onClick={() => void api.app.window('minimize')} aria-label="Minimise">
          <Minus size={15} />
        </button>
        <button
          className="window-control"
          onClick={() => {
            void api.app.window('maximize')
            setMaximized((value) => !value)
          }}
          aria-label="Maximise"
        >
          {maximized ? <Copy size={13} /> : <Square size={12} />}
        </button>
        <button className="window-control close" onClick={() => void api.app.window('close')} aria-label="Close">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- sidebar */

interface NavEntry {
  route: Route
  label: string
  icon: typeof Home
}

const PRIMARY: NavEntry[] = [
  { route: 'home', label: 'Home', icon: Home },
  { route: 'play', label: 'Play', icon: Play }
]

const LIBRARY: NavEntry[] = [
  { route: 'instances', label: 'Instances', icon: Boxes },
  { route: 'versions', label: 'Versions', icon: Layers },
  { route: 'mods', label: 'Mods & Packs', icon: Package },
  { route: 'worlds', label: 'Worlds', icon: Globe2 },
  { route: 'servers', label: 'Servers', icon: Server },
  { route: 'host', label: 'Host a Server', icon: HardDrive }
]

const ACCOUNT: NavEntry[] = [
  { route: 'companion', label: 'AI Companion', icon: Bot },
  { route: 'skins', label: 'Skins', icon: Shirt },
  { route: 'account', label: 'Account', icon: UserCircle2 },
  { route: 'settings', label: 'Settings', icon: SettingsIcon }
]

export function Sidebar(): JSX.Element {
  const route = useStore((s) => s.route)
  const navigate = useStore((s) => s.navigate)
  const account = useStore(activeAccount)
  const instances = useStore((s) => s.instances)
  const downloads = useStore((s) => s.downloads)

  const activeDownloads = Object.values(downloads).filter((d) => d.active).length

  const renderGroup = (entries: NavEntry[]): JSX.Element[] =>
    entries.map(({ route: target, label, icon: Icon }) => (
      <button
        key={target}
        className={`nav-item ${route === target ? 'active' : ''}`}
        onClick={() => navigate(target)}
      >
        <Icon size={16.5} strokeWidth={2} />
        {label}
        {target === 'instances' && instances.length > 0 && <span className="badge">{instances.length}</span>}
        {target === 'play' && activeDownloads > 0 && <span className="badge">{activeDownloads}</span>}
      </button>
    ))

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <Logo size={30} />
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">NexusCraft</span>
          <span className="sidebar-brand-sub">Launcher</span>
        </div>
      </div>

      {renderGroup(PRIMARY)}

      <div className="nav-section">Library</div>
      {renderGroup(LIBRARY)}

      <div className="nav-section">You</div>
      {renderGroup(ACCOUNT)}

      <div className="sidebar-footer">
        <button
          className="panel panel-hover row gap-10"
          style={{
            width: '100%',
            padding: 9,
            border: '1px solid var(--border)',
            background: 'var(--panel)',
            textAlign: 'left',
            gap: 10
          }}
          onClick={() => navigate('account')}
        >
          <SkinFace skinDataUrl={account?.skinDataUrl} size={30} radius={8} />
          <div className="flex-1" style={{ minWidth: 0 }}>
            <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {account?.username ?? 'Not signed in'}
            </div>
            <div className="truncate tiny dim">
              {account ? (account.gamertag ?? 'Microsoft account') : 'Sign in to play'}
            </div>
          </div>
        </button>
      </div>
    </nav>
  )
}
