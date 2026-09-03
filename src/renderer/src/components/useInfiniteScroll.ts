import { useEffect, useRef } from 'react'

/**
 * Loads the next page when a sentinel element scrolls into view.
 *
 * The alternative is a "Load more" button, which is a click per twenty results
 * and makes browsing a catalogue of thousands feel like paging through a filing
 * cabinet. This watches an empty element placed after the last row instead, so
 * the next page is already arriving by the time you reach the bottom.
 *
 * `rootMargin` is why it feels seamless rather than stuttery: the sentinel
 * counts as visible while it is still a screen below the fold, so the request
 * goes out early and the results are usually there before the gap is.
 *
 * The callback is held in a ref rather than listed as a dependency. An inline
 * arrow function is a new value every render, and depending on it would tear
 * down and rebuild the observer each time — which fires it again on the way in,
 * and requests the same page repeatedly.
 */
export function useInfiniteScroll(
  onReachEnd: () => void,
  options: { enabled: boolean; rootMargin?: string }
): React.RefObject<HTMLDivElement> {
  const sentinel = useRef<HTMLDivElement>(null)
  const callback = useRef(onReachEnd)
  callback.current = onReachEnd

  const { enabled, rootMargin = '600px' } = options

  useEffect(() => {
    const element = sentinel.current
    if (!element || !enabled) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callback.current()
      },
      { rootMargin }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, rootMargin])

  return sentinel
}
