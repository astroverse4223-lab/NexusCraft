interface LogoProps {
  size?: number
  /** Renders the glow filter. Disable for tiny sizes where it muddies the mark. */
  glow?: boolean
}

/**
 * The NexusCraft mark: an isometric cube built from three rhombi, with a
 * connecting "nexus" node at its core. Original artwork — it deliberately
 * avoids Mojang's own iconography.
 */
export function Logo({ size = 30, glow = true }: LogoProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="NexusCraft" role="img">
      <defs>
        <linearGradient id="nc-top" x1="24" y1="4" x2="24" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.72" />
        </linearGradient>
        <linearGradient id="nc-left" x1="6" y1="14" x2="24" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--accent)" stopOpacity="0.55" />
          <stop offset="1" stopColor="#818cf8" stopOpacity="0.42" />
        </linearGradient>
        <linearGradient id="nc-right" x1="42" y1="14" x2="24" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#818cf8" stopOpacity="0.75" />
          <stop offset="1" stopColor="#c084fc" stopOpacity="0.5" />
        </linearGradient>
        {glow && (
          <filter id="nc-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>

      <g filter={glow ? 'url(#nc-glow)' : undefined}>
        {/* top face */}
        <path d="M24 3.5 42.5 14 24 24.5 5.5 14 24 3.5Z" fill="url(#nc-top)" />
        {/* left face */}
        <path d="M5.5 14 24 24.5V45L5.5 34.5V14Z" fill="url(#nc-left)" />
        {/* right face */}
        <path d="M42.5 14 24 24.5V45l18.5-10.5V14Z" fill="url(#nc-right)" />

        {/* nexus core */}
        <circle cx="24" cy="24.5" r="3.4" fill="var(--bg-0)" />
        <circle cx="24" cy="24.5" r="2.1" fill="var(--accent)" />

        {/* edge highlights */}
        <path
          d="M24 3.5 42.5 14 24 24.5 5.5 14 24 3.5Z"
          stroke="var(--accent)"
          strokeOpacity="0.55"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        <path d="M24 24.5V45" stroke="var(--accent)" strokeOpacity="0.32" strokeWidth="0.9" />
      </g>
    </svg>
  )
}

/** Wordmark used on the welcome and loading screens. */
export function LogoLockup({ size = 60 }: { size?: number }): JSX.Element {
  return (
    <div className="row gap-16">
      <Logo size={size} />
      <div className="col">
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: size * 0.46,
            fontWeight: 700,
            letterSpacing: '-0.025em',
            lineHeight: 1.05
          }}
        >
          NexusCraft
        </div>
        <div
          style={{
            fontSize: size * 0.16,
            letterSpacing: '0.34em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            fontWeight: 600,
            marginTop: 2
          }}
        >
          Launcher
        </div>
      </div>
    </div>
  )
}
