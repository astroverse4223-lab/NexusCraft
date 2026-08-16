import { useEffect, useRef, type ReactNode, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { LauncherErrorPayload } from '@shared/types'

/* --------------------------------------------------------------- modal */

interface ModalProps {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}

export function Modal({ open, title, subtitle, onClose, children, footer, width }: ModalProps): JSX.Element {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.div
            className="modal"
            style={width ? { maxWidth: width } : undefined}
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="modal-header">
              <div>
                <h2>{title}</h2>
                {subtitle && <p className="muted small mt-8">{subtitle}</p>}
              </div>
              <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
                <X size={17} />
              </button>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* -------------------------------------------------------- confirm dialog */

interface ConfirmProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  busy,
  onConfirm,
  onCancel
}: ConfirmProps): JSX.Element {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm} disabled={busy}>
            {busy && <span className="spinner" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Modal>
  )
}

/* ---------------------------------------------------------- error screen */

interface ErrorViewProps {
  error: LauncherErrorPayload
  onRetry?: () => void
  onDismiss?: () => void
  compact?: boolean
}

/**
 * The single place raw failures become something a player can act on: a plain
 * headline, an explanation, and concrete next steps. Technical detail is folded
 * away rather than dumped on screen.
 */
export function ErrorView({ error, onRetry, onDismiss, compact }: ErrorViewProps): JSX.Element {
  return (
    <div
      className="panel panel-pad"
      style={{
        borderColor: 'color-mix(in srgb, var(--danger) 32%, transparent)',
        background: 'color-mix(in srgb, var(--danger) 7%, transparent)'
      }}
    >
      <div className="row items-start gap-12">
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 11,
            display: 'grid',
            placeItems: 'center',
            background: 'color-mix(in srgb, var(--danger) 16%, transparent)',
            color: 'var(--danger)',
            flexShrink: 0
          }}
        >
          <AlertTriangle size={18} />
        </div>

        <div className="flex-1">
          <h3>{error.title}</h3>
          <p className="muted small mt-8">{error.message}</p>

          {error.actions.length > 0 && (
            <ul className="col gap-4 mt-16" style={{ margin: 0, paddingLeft: 18 }}>
              {error.actions.map((action, index) => (
                <li key={index} className="small muted">
                  {action}
                </li>
              ))}
            </ul>
          )}

          {error.detail && !compact && (
            <details className="mt-16">
              <summary className="tiny dim" style={{ cursor: 'pointer' }}>
                Technical detail
              </summary>
              <pre
                className="mono selectable mt-8"
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--text-dim)',
                  background: 'rgba(0,0,0,0.32)',
                  padding: 11,
                  borderRadius: 9,
                  maxHeight: 190,
                  overflow: 'auto',
                  margin: 0
                }}
              >
                {error.detail}
              </pre>
            </details>
          )}

          {(onRetry || onDismiss) && (
            <div className="row gap-8 mt-16">
              {onRetry && (
                <button className="btn btn-primary btn-sm" onClick={onRetry}>
                  Try again
                </button>
              )}
              {onDismiss && (
                <button className="btn btn-sm" onClick={onDismiss}>
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- toasts */

const TOAST_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle
} as const

const TOAST_COLORS = {
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--danger)'
} as const

interface ToastProps {
  toasts: Array<{ id: number; kind: keyof typeof TOAST_ICONS; title: string; message?: string }>
  onDismiss: (id: number) => void
}

export function ToastStack({ toasts, onDismiss }: ToastProps): JSX.Element {
  return (
    <div className="toast-stack">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = TOAST_ICONS[toast.kind]
          return (
            <motion.div
              key={toast.id}
              className="toast"
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <Icon size={17} style={{ color: TOAST_COLORS[toast.kind], flexShrink: 0, marginTop: 1 }} />
              <div className="flex-1">
                <div className="toast-title">{toast.title}</div>
                {toast.message && <div className="toast-message">{toast.message}</div>}
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------ primitives */

export function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`toggle ${checked ? 'on' : ''}`}
      style={{ border: 'none', opacity: disabled ? 0.5 : 1 }}
      onClick={() => !disabled && onChange(!checked)}
    />
  )
}

export function SettingRow({
  name,
  description,
  children
}: {
  name: string
  description?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-name">{name}</div>
        {description && <div className="setting-desc">{description}</div>}
      </div>
      {children}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  message,
  action
}: {
  icon: ReactNode
  title: string
  message: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="empty-state">
      <div className="icon-wrap">{icon}</div>
      <h3>{title}</h3>
      <p className="small muted" style={{ maxWidth: '44ch' }}>
        {message}
      </p>
      {action && <div className="mt-8">{action}</div>}
    </div>
  )
}

export function ProgressBar({
  value,
  indeterminate,
  style
}: {
  value: number
  indeterminate?: boolean
  style?: CSSProperties
}): JSX.Element {
  return (
    <div className="progress-track" style={style}>
      <div
        className={`progress-fill ${indeterminate ? 'indeterminate' : ''}`}
        style={{ width: indeterminate ? undefined : `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  )
}

export function Spinner({ large }: { large?: boolean }): JSX.Element {
  return <span className={large ? 'spinner lg' : 'spinner'} />
}

/** Fades and lifts a screen into place on navigation. */
export function ScreenTransition({ children, id }: { children: ReactNode; id: string }): JSX.Element {
  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      style={{ minHeight: '100%' }}
    >
      {children}
    </motion.div>
  )
}

/** Scrolls its container to the bottom whenever the dependency changes. */
export function useAutoScroll<T>(dependency: T): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    // Only follow along if the user has not scrolled up to read history.
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 90
    if (nearBottom) element.scrollTop = element.scrollHeight
  }, [dependency])
  return ref
}
