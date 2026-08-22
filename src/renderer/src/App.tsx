import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Background } from './components/Background'
import { Sidebar, TitleBar } from './components/Shell'
import { ErrorView, Modal, ScreenTransition, Spinner, ToastStack } from './components/ui'
import { LogoLockup } from './components/Logo'
import { useStore } from './store/useStore'

import { HomeScreen } from './screens/Home'
import { PlayScreen } from './screens/Play'
import { InstancesScreen } from './screens/Instances'
import { VersionsScreen } from './screens/Versions'
import { ModsScreen } from './screens/Mods'
import { WorldsScreen } from './screens/Worlds'
import { ServersScreen } from './screens/Servers'
import { HostServerScreen } from './screens/HostServer'
import { SkinsScreen } from './screens/Skins'
import { AccountScreen } from './screens/Account'
import { SettingsScreen } from './screens/Settings'
import { CompanionScreen } from './screens/Companion'

export default function App(): JSX.Element {
  const ready = useStore((s) => s.ready)
  const bootError = useStore((s) => s.bootError)
  const boot = useStore((s) => s.boot)
  const route = useStore((s) => s.route)
  const settings = useStore((s) => s.settings)
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)
  const errorModal = useStore((s) => s.errorModal)
  const dismissError = useStore((s) => s.dismissError)

  useEffect(() => {
    void boot()
  }, [boot])

  if (!ready) return <BootScreen />

  if (bootError) {
    return (
      <>
        <Background animated particles={false} />
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 40, position: 'relative' }}>
          <div style={{ maxWidth: 560, width: '100%' }}>
            <div className="mb-24">
              <LogoLockup size={44} />
            </div>
            <ErrorView error={bootError} onRetry={() => window.location.reload()} />
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Background animated={settings?.animatedBackground ?? true} particles={settings?.particles ?? true} />

      <div className="app-shell">
        <TitleBar />
        <div className="app-body">
          <Sidebar />
          <main className="screen">
            <AnimatePresence mode="wait">
              <ScreenTransition id={route}>{renderRoute(route)}</ScreenTransition>
            </AnimatePresence>
          </main>
        </div>
      </div>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Modal open={Boolean(errorModal)} title="" onClose={dismissError} width={540}>
        {errorModal && <ErrorView error={errorModal} onDismiss={dismissError} />}
      </Modal>
    </>
  )
}

function renderRoute(route: string): JSX.Element {
  switch (route) {
    case 'home':
      return <HomeScreen />
    case 'play':
      return <PlayScreen />
    case 'instances':
      return <InstancesScreen />
    case 'versions':
      return <VersionsScreen />
    case 'mods':
      return <ModsScreen />
    case 'worlds':
      return <WorldsScreen />
    case 'servers':
      return <ServersScreen />
    case 'host':
      return <HostServerScreen />
    case 'skins':
      return <SkinsScreen />
    case 'account':
      return <AccountScreen />
    case 'settings':
      return <SettingsScreen />
    case 'companion':
      return <CompanionScreen />
    default:
      return <HomeScreen />
  }
}

/** Shown for the fraction of a second before the first IPC round trip lands. */
function BootScreen(): JSX.Element {
  return (
    <>
      <Background animated particles />
      <div
        style={{
          position: 'relative',
          display: 'grid',
          placeItems: 'center',
          height: '100%',
          gap: 26
        }}
      >
        <div className="col center items-center gap-24" style={{ alignItems: 'center' }}>
          <LogoLockup size={64} />
          <div className="row gap-12 muted small">
            <Spinner />
            Starting NexusCraft…
          </div>
        </div>
      </div>
    </>
  )
}
