import { useState } from 'react'
import { Boxes, FileArchive, Package } from 'lucide-react'
import type { LauncherErrorPayload, ModpackInfo } from '@shared/types'
import { api, toPayload } from '../api'
import { useStore } from '../store/useStore'
import { ErrorView, Modal, Spinner } from '../components/ui'
import { LOADER_LABELS } from '../format'

/**
 * Imports a Modrinth `.mrpack` as a new instance.
 *
 * The manifest is read and shown before anything is installed, so the user sees
 * what Minecraft version and loader the pack will create rather than finding out
 * afterwards.
 */
export function ModpackImportModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const refreshInstances = useStore((s) => s.refreshInstances)
  const selectInstance = useStore((s) => s.selectInstance)
  const navigate = useStore((s) => s.navigate)

  const [filePath, setFilePath] = useState('')
  const [info, setInfo] = useState<ModpackInfo | null>(null)
  const [name, setName] = useState('')
  const [reading, setReading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  function reset(): void {
    setFilePath('')
    setInfo(null)
    setName('')
    setError(null)
  }

  async function pick(): Promise<void> {
    setError(null)
    const files = await api.app.pickFiles({ title: 'Choose a .mrpack modpack', extensions: ['mrpack'], multi: false })
    if (!files[0]) return

    setFilePath(files[0])
    setReading(true)
    try {
      const inspected = await api.modpacks.inspect(files[0])
      setInfo(inspected)
      setName(inspected.name)
    } catch (err) {
      setError(toPayload(err))
      setInfo(null)
    } finally {
      setReading(false)
    }
  }

  async function install(): Promise<void> {
    setInstalling(true)
    setError(null)
    try {
      const result = await api.modpacks.installFile(filePath, name)
      await refreshInstances()
      await selectInstance(result.instance.id)
      reset()
      onClose()
      navigate('play')
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Import a modpack"
      subtitle="Modrinth .mrpack files become a new, fully separate instance."
      onClose={() => {
        reset()
        onClose()
      }}
      width={560}
      footer={
        <>
          <button
            className="btn"
            onClick={() => {
              reset()
              onClose()
            }}
            disabled={installing}
          >
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!info || installing} onClick={() => void install()}>
            {installing && <Spinner />}
            {installing ? 'Installing…' : 'Create instance'}
          </button>
        </>
      }
    >
      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <div className="field">
        <label className="field-label">Modpack file</label>
        <div className="row gap-8">
          <input className="input" value={filePath} readOnly placeholder="No file chosen" />
          <button className="btn" onClick={() => void pick()} disabled={reading || installing}>
            {reading ? <Spinner /> : <FileArchive size={15} />} Browse
          </button>
        </div>
        <p className="field-hint">
          Download a pack from Modrinth as a <code className="mono">.mrpack</code> file. CurseForge packs use a
          different format and are not supported yet.
        </p>
      </div>

      {info && (
        <>
          <div className="panel panel-pad col gap-12">
            <div className="row gap-12">
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 11,
                  background: 'var(--accent-dim)',
                  color: 'var(--accent)',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0
                }}
              >
                <Package size={19} />
              </div>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{info.name}</div>
                <div className="tiny dim">{info.version}</div>
              </div>
            </div>

            {info.summary && <p className="small muted">{info.summary}</p>}

            <div className="row gap-8 wrap">
              <span className="pill accent">Minecraft {info.minecraftVersion}</span>
              <span className="pill">{LOADER_LABELS[info.loader]}</span>
              {info.loaderVersion && <span className="pill">{info.loaderVersion}</span>}
              <span className="pill">{info.fileCount} mods</span>
              {info.overrideCount > 0 && <span className="pill">{info.overrideCount} config files</span>}
            </div>
          </div>

          <div className="field">
            <label className="field-label">Instance name</label>
            <input
              className="input"
              value={name}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="row gap-8 small muted">
            <Boxes size={15} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              A new instance is created with its own mods, worlds and settings. Nothing is added to your existing
              instances.
            </span>
          </div>
        </>
      )}
    </Modal>
  )
}
