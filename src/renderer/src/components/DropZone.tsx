import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { UploadCloud } from 'lucide-react'

/**
 * Wraps a screen so files can be dropped onto it.
 *
 * The renderer is sandboxed and cannot read a file itself, so a drop is turned
 * into on-disk paths through the preload bridge and handed to the same main
 * process importers the file picker uses. Anything the drop contains that does
 * not match `extensions` is dropped silently rather than reported: a folder of
 * mods that also holds a readme should install the mods, not raise an error.
 */

interface DropZoneProps {
  /** Lower-case extensions to accept, without the dot. Empty accepts everything. */
  extensions?: string[]
  /** What to show while a matching drag is over the zone. */
  label: string
  hint?: string
  /** Receives the absolute paths of the accepted files. */
  onFiles: (paths: string[]) => void | Promise<void>
  disabled?: boolean
  children: ReactNode
  className?: string
}

function matches(name: string, extensions: string[]): boolean {
  if (extensions.length === 0) return true
  const lower = name.toLowerCase()
  return extensions.some((ext) => lower.endsWith(`.${ext.toLowerCase()}`))
}

export function DropZone({
  extensions = [],
  label,
  hint,
  onFiles,
  disabled = false,
  children,
  className
}: DropZoneProps): JSX.Element {
  const [over, setOver] = useState(false)

  /*
   * Drag events fire for every child element the pointer crosses, so a plain
   * enter/leave pair flickers the overlay across a busy screen. Counting
   * enters against leaves tracks the pointer against the zone as a whole.
   */
  const depth = useRef(0)

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (disabled) return
      if (!event.dataTransfer.types.includes('Files')) return
      depth.current += 1
      setOver(true)
    },
    [disabled]
  )

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setOver(false)
  }, [])

  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (disabled) return
      if (!event.dataTransfer.types.includes('Files')) return
      // Without this the page navigates to the dropped file instead.
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    [disabled]
  )

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (disabled) return
      event.preventDefault()
      depth.current = 0
      setOver(false)

      const paths: string[] = []
      for (const file of Array.from(event.dataTransfer.files)) {
        if (!matches(file.name, extensions)) continue
        const path = window.nexus.filePath(file)
        if (path) paths.push(path)
      }
      if (paths.length > 0) void onFiles(paths)
    },
    [disabled, extensions, onFiles]
  )

  return (
    <div
      className={className}
      style={{ position: 'relative', minHeight: '100%' }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}

      <AnimatePresence>
        {over && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 40,
              display: 'grid',
              placeItems: 'center',
              // The overlay is a hint, not a target: pointer events would
              // swallow the drop it is advertising.
              pointerEvents: 'none',
              borderRadius: 'var(--radius-lg)',
              border: '2px dashed var(--accent)',
              background: 'rgba(5, 7, 12, 0.82)',
              backdropFilter: 'blur(3px)'
            }}
          >
            <div style={{ textAlign: 'center', padding: 24 }}>
              <UploadCloud size={38} color="var(--accent)" />
              <div className="mt-12" style={{ fontFamily: 'var(--font-display)', fontSize: 19 }}>
                {label}
              </div>
              {hint && <div className="muted small mt-8">{hint}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
