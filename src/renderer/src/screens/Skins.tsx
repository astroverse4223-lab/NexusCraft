import { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, Plus, RotateCcw, Shirt, Star, Trash2, Upload } from 'lucide-react'
import type { LauncherErrorPayload, SavedSkin } from '@shared/types'
import { api, toPayload } from '../api'
import { useStore, activeAccount } from '../store/useStore'
import { ConfirmDialog, EmptyState, ErrorView, Modal, Spinner } from '../components/ui'
import { SkinBody, SkinTexture } from '../components/SkinView'
import { DropZone } from '../components/DropZone'
import { formatRelative } from '../format'

export function SkinsScreen(): JSX.Element {
  const account = useStore(activeAccount)
  const refreshAccounts = useStore((s) => s.refreshAccounts)
  const pushToast = useStore((s) => s.pushToast)

  const [skins, setSkins] = useState<SavedSkin[] | null>(null)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<SavedSkin | null>(null)
  const [resetting, setResetting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<SavedSkin | null>(null)
  /** A PNG dropped onto the screen, waiting for the import dialog to name it. */
  const [dropped, setDropped] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setSkins(await api.skins.list())
      setError(null)
    } catch (err) {
      setError(toPayload(err))
      setSkins([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function apply(skin: SavedSkin): Promise<void> {
    setApplying(skin.id)
    try {
      await api.skins.apply(skin.id)
      await refreshAccounts()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setApplying(null)
    }
  }

  if (!account) {
    return (
      <div className="panel">
        <EmptyState
          icon={<Shirt size={24} />}
          title="Sign in to manage skins"
          message="Your skin lives on your Minecraft profile, so NexusCraft needs you signed in to read or change it."
        />
      </div>
    )
  }

  return (
    <DropZone
      extensions={['png']}
      label="Drop a skin PNG"
      hint="You will be asked to name it and pick the arm model"
      onFiles={(paths) => {
        if (!paths[0]) return
        setDropped(paths[0])
        setImportOpen(true)
      }}
    >
      <div className="screen-header">
        <div>
          <div className="eyebrow">You</div>
          <h1>Skins</h1>
          <p className="subtitle">
            Save a library of skins and apply them to your Minecraft profile. Changes go through Mojang's official
            profile service, exactly as they would on minecraft.net.
          </p>
        </div>
        <div className="row gap-8">
          <button className="btn" onClick={() => void api.app.openExternal('https://www.minecraft.net/profile/skin')}>
            <ExternalLink size={15} /> Minecraft profile
          </button>
          <button className="btn btn-primary" onClick={() => setImportOpen(true)}>
            <Plus size={16} /> Import skin
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-16">
          <ErrorView error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* current appearance */}
      <div className="panel panel-pad mb-24">
        <div className="row gap-24 items-start wrap">
          <SkinBody skinDataUrl={account.skinDataUrl} variant={account.skinVariant} height={230} dramatic />

          <div className="flex-1 col gap-12" style={{ minWidth: 240 }}>
            <div>
              <div className="section-title" style={{ marginBottom: 4 }}>
                Current skin
              </div>
              <h2>{account.username}</h2>
              <p className="small muted mt-8">
                Model: {account.skinVariant === 'slim' ? 'Slim (Alex, 3px arms)' : 'Classic (Steve, 4px arms)'}
              </p>
            </div>

            {account.capes.length > 0 && (
              <div>
                <div className="field-label mb-8">Capes on your account</div>
                <div className="row gap-8 wrap">
                  {account.capes.map((cape) => (
                    <div
                      key={cape.id}
                      className="panel row gap-8"
                      style={{
                        padding: '6px 10px',
                        borderColor: cape.state === 'ACTIVE' ? 'var(--accent)' : undefined
                      }}
                    >
                      {cape.imageDataUrl && (
                        <img
                          src={cape.imageDataUrl}
                          width={20}
                          height={32}
                          alt=""
                          style={{ imageRendering: 'pixelated', objectFit: 'cover', borderRadius: 3 }}
                        />
                      )}
                      <span className="small">{cape.name}</span>
                      {cape.state === 'ACTIVE' && <Check size={13} style={{ color: 'var(--accent)' }} />}
                    </div>
                  ))}
                </div>
                <p className="field-hint mt-8">
                  Capes are granted by Mojang and are chosen in game or on your Minecraft profile page.
                </p>
              </div>
            )}

            <div className="row gap-8 mt-8">
              <button className="btn" disabled={resetting} onClick={() => setResetting(true)}>
                <RotateCcw size={14} /> Reset to default skin
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* library */}
      <div className="section-title">Your skin library</div>

      {skins === null ? (
        <div className="panel panel-pad row gap-12 muted">
          <Spinner /> Loading saved skins…
        </div>
      ) : skins.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Shirt size={24} />}
            title="No saved skins"
            message="Import a 64x64 PNG skin to keep it here. You can apply any saved skin to your profile in one click."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setImportOpen(true)}>
                <Upload size={14} /> Import a skin
              </button>
            }
          />
        </div>
      ) : (
        <div className="card-grid">
          {skins.map((skin) => (
            <div key={skin.id} className="panel panel-hover panel-pad col gap-12">
              <div className="row gap-12">
                <button
                  onClick={() => setPreview(skin)}
                  style={{ background: 'none', border: 'none', padding: 0 }}
                  title="Preview"
                >
                  <SkinTexture dataUrl={skin.dataUrl} size={72} />
                </button>
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 650 }}>
                    {skin.name}
                  </div>
                  <div className="tiny dim">{skin.variant === 'slim' ? 'Slim model' : 'Classic model'}</div>
                  <div className="tiny dim">Added {formatRelative(skin.addedAt)}</div>
                </div>
                <button
                  className="btn btn-ghost btn-icon"
                  title={skin.favorite ? 'Remove from favourites' : 'Add to favourites'}
                  onClick={() => {
                    void api.skins.favorite(skin.id, !skin.favorite).then(load).catch((err) => setError(toPayload(err)))
                  }}
                >
                  <Star
                    size={15}
                    fill={skin.favorite ? 'var(--warning)' : 'none'}
                    style={skin.favorite ? { color: 'var(--warning)' } : undefined}
                  />
                </button>
              </div>

              <div className="row gap-8">
                <button
                  className="btn btn-primary btn-sm flex-1"
                  disabled={applying !== null}
                  onClick={() => void apply(skin)}
                >
                  {applying === skin.id ? <Spinner /> : <Check size={13} />}
                  {applying === skin.id ? 'Applying…' : 'Apply to profile'}
                </button>
                <button className="btn btn-ghost btn-icon" title="Delete" onClick={() => setDeleting(skin)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ImportSkinModal
        open={importOpen}
        initialPath={dropped}
        onClose={() => {
          setImportOpen(false)
          setDropped(null)
        }}
        onImported={() => {
          setImportOpen(false)
          setDropped(null)
          void load()
          pushToast({ kind: 'success', title: 'Skin saved to your library' })
        }}
      />

      {/* preview */}
      <Modal open={Boolean(preview)} title={preview?.name ?? ''} onClose={() => setPreview(null)} width={440}>
        {preview && (
          <div className="row gap-24 center" style={{ justifyContent: 'center' }}>
            <SkinBody skinDataUrl={preview.dataUrl} variant={preview.variant} height={250} dramatic />
            <div className="col gap-12">
              <SkinTexture dataUrl={preview.dataUrl} size={128} />
              <span className="tiny dim">Raw 64×64 texture</span>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete "${deleting?.name}"?`}
        message="This removes the skin from your NexusCraft library. If it is currently applied to your Minecraft profile, it stays applied."
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => {
          if (!deleting) return
          setBusy(true)
          void api.skins
            .remove(deleting.id)
            .then(() => {
              setDeleting(null)
              return load()
            })
            .catch((err) => setError(toPayload(err)))
            .finally(() => setBusy(false))
        }}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={resetting}
        title="Reset to the default skin?"
        message="Your custom skin will be removed from your Minecraft profile and you will appear as the default Steve or Alex. Saved skins in your library are not affected."
        confirmLabel="Reset skin"
        busy={busy}
        onConfirm={() => {
          setBusy(true)
          void api.skins
            .reset()
            .then(() => {
              setResetting(false)
              return refreshAccounts()
            })
            .catch((err) => setError(toPayload(err)))
            .finally(() => setBusy(false))
        }}
        onCancel={() => setResetting(false)}
      />
    </DropZone>
  )
}

/* --------------------------------------------------------------- import */

function ImportSkinModal({
  open,
  onClose,
  onImported,
  initialPath
}: {
  open: boolean
  onClose: () => void
  onImported: () => void
  /** Pre-selected file, set when the user dropped a PNG onto the screen. */
  initialPath?: string | null
}): JSX.Element {
  const [filePath, setFilePath] = useState('')
  const [name, setName] = useState('')
  const [variant, setVariant] = useState<'classic' | 'slim'>('classic')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LauncherErrorPayload | null>(null)

  useEffect(() => {
    if (!open) {
      setFilePath('')
      setName('')
      setError(null)
      return
    }
    if (initialPath) {
      setFilePath(initialPath)
      const base = initialPath.split(/[\\/]/).pop() ?? ''
      setName((current) => current || base.replace(/\.png$/i, ''))
    }
  }, [open, initialPath])

  async function pick(): Promise<void> {
    const files = await api.app.pickFiles({ title: 'Choose a skin PNG', extensions: ['png'], multi: false })
    if (files[0]) {
      setFilePath(files[0])
      // Suggest the file name, without its extension, as the skin name.
      const base = files[0].split(/[\\/]/).pop() ?? ''
      setName((current) => current || base.replace(/\.png$/i, ''))
    }
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.skins.import(filePath, name.trim() || 'Untitled skin', variant)
      onImported()
    } catch (err) {
      setError(toPayload(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Import a skin"
      subtitle="Minecraft skins are 64×64 PNG images. The classic model has 4-pixel arms; the slim model has 3."
      onClose={onClose}
      width={500}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !filePath}>
            {busy && <Spinner />} Save to library
          </button>
        </>
      }
    >
      {error && <ErrorView error={error} onDismiss={() => setError(null)} compact />}

      <div className="field">
        <label className="field-label">Skin file</label>
        <div className="row gap-8">
          <input className="input" value={filePath} readOnly placeholder="No file chosen" />
          <button className="btn" onClick={() => void pick()}>
            Browse
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label">Name</label>
        <input className="input" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} />
      </div>

      <div className="field">
        <label className="field-label">Model</label>
        <div className="row gap-8">
          <button
            className={`btn btn-sm ${variant === 'classic' ? 'btn-primary' : ''}`}
            onClick={() => setVariant('classic')}
          >
            Classic
          </button>
          <button className={`btn btn-sm ${variant === 'slim' ? 'btn-primary' : ''}`} onClick={() => setVariant('slim')}>
            Slim
          </button>
        </div>
      </div>
    </Modal>
  )
}
