import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

/**
 * Catches render-time exceptions.
 *
 * Without this, a single throw anywhere in the tree unmounts the whole app and
 * leaves nothing but the page background — a black window with no explanation
 * and no way back. This turns that into a readable message, keeps a Reload
 * button available, and forwards the stack to the main process log.
 */
interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    report('react-render', error, info.componentStack ?? undefined)
  }

  render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          padding: 40,
          background: 'var(--bg-0)',
          overflow: 'auto',
          zIndex: 999
        }}
      >
        <div className="panel panel-pad" style={{ maxWidth: 720, width: '100%' }}>
          <h2 style={{ color: 'var(--danger)' }}>The launcher interface crashed</h2>
          <p className="muted small mt-8">
            Something went wrong while drawing this screen. Your instances, worlds and account are unaffected — this is
            a fault in the launcher's interface, not in your game files. The details below have been written to the
            launcher log.
          </p>

          <pre
            className="mono selectable mt-16"
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text-dim)',
              background: 'rgba(0,0,0,0.36)',
              padding: 12,
              borderRadius: 9,
              maxHeight: 260,
              overflow: 'auto',
              margin: 0
            }}
          >
            {error.name}: {error.message}
            {error.stack ? `\n\n${error.stack.split('\n').slice(1, 8).join('\n')}` : ''}
            {componentStack ? `\n\nIn component:${componentStack.split('\n').slice(0, 6).join('\n')}` : ''}
          </pre>

          <div className="row gap-8 mt-16">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              <RefreshCw size={15} /> Reload the launcher
            </button>
            <button className="btn" onClick={() => this.setState({ error: null, componentStack: null })}>
              Try to continue
            </button>
          </div>
        </div>
      </div>
    )
  }
}

/** Sends a renderer-side failure to the main process log. Never throws. */
export function report(source: string, error: unknown, componentStack?: string): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error))
    void window.nexus?.invoke('app:reportError', {
      source,
      message: err.message.slice(0, 2000),
      stack: err.stack?.slice(0, 8000),
      componentStack: componentStack?.slice(0, 8000)
    })
  } catch {
    /* reporting must never itself break the UI */
  }
}

/**
 * Catches the failures React cannot: errors thrown outside render, and promise
 * rejections that nothing awaited.
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    report('window-error', event.error ?? event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    report('unhandled-rejection', event.reason)
  })
}
