import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { api } from '../api'

/**
 * Talking to the companion instead of typing at it.
 *
 * Uses the speech recognition already in Chromium, which turned out to work in
 * this Electron build once the main process stops denying the microphone. That
 * was worth checking rather than assuming: the usual outcome is a `network`
 * error, because most Electron builds ship without the key Chromium's speech
 * service wants, and the fallback would have been bundling a local model and a
 * few hundred megabytes with it.
 *
 * Push to talk rather than always listening. A microphone that is open the
 * whole time a game is running is not something to switch on by default, and
 * holding a button is also how you avoid sending it every word of a
 * conversation happening in the room.
 */

/** Chromium exposes it under the prefix; the standard name is not defined. */
type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

function createRecognition(): Recognition | null {
  const Ctor =
    (window as unknown as { webkitSpeechRecognition?: new () => Recognition })
      .webkitSpeechRecognition ??
    (window as unknown as { SpeechRecognition?: new () => Recognition }).SpeechRecognition
  return Ctor ? new Ctor() : null
}

export function MicButton({
  disabled,
  onHeard
}: {
  disabled: boolean
  /** Called with the finished transcript. */
  onHeard: (text: string) => void
}): JSX.Element | null {
  const [listening, setListening] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const recognition = useRef<Recognition | null>(null)

  const supported = typeof window !== 'undefined' && Boolean(createRecognition())

  useEffect(() => {
    return () => {
      // Never leave the microphone open behind a closed screen.
      try {
        recognition.current?.stop()
      } catch {
        /* already stopped */
      }
      void api.companion.setMicrophone(false)
    }
  }, [])

  if (!supported) return null

  async function start(): Promise<void> {
    setProblem(null)

    /*
     * The main process denies the microphone unless this is set. It is raised
     * only for as long as the button is held, so the permission is not left
     * standing for the life of the app after one use.
     */
    try {
      await api.companion.setMicrophone(true)
    } catch {
      setProblem('could not enable the microphone')
      return
    }

    const instance = createRecognition()
    if (!instance) return
    recognition.current = instance

    instance.continuous = false
    instance.interimResults = false
    instance.lang = 'en-US'

    instance.onresult = (event) => {
      const said = event.results?.[0]?.[0]?.transcript?.trim()
      if (said) onHeard(said)
    }
    instance.onerror = (event) => {
      // 'no-speech' is the common one and is not worth reporting as a fault.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setProblem(event.error === 'not-allowed' ? 'microphone blocked' : event.error)
      }
    }
    instance.onend = () => {
      setListening(false)
      void api.companion.setMicrophone(false)
    }

    try {
      instance.start()
      setListening(true)
    } catch {
      setProblem('could not start listening')
      void api.companion.setMicrophone(false)
    }
  }

  function stop(): void {
    try {
      recognition.current?.stop()
    } catch {
      /* already stopped */
    }
    setListening(false)
  }

  return (
    <div className="row gap-8 items-center">
      <button
        className={`btn ${listening ? 'btn-primary' : ''}`}
        disabled={disabled}
        title={listening ? 'Listening — click to stop' : 'Hold a moment and speak'}
        onClick={() => (listening ? stop() : void start())}
      >
        {listening ? <Mic size={15} /> : <MicOff size={15} />}
        {listening ? 'Listening…' : 'Speak'}
      </button>
      {problem && <span className="tiny dim">{problem}</span>}
    </div>
  )
}
