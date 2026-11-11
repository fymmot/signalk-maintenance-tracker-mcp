import { signal } from '@preact/signals'

/* M3 window size classes as signals: compact < 600, medium 600–839, expanded ≥ 840. */

function watch(query: string) {
  const mq = window.matchMedia(query)
  const s = signal(mq.matches)
  mq.addEventListener('change', (e) => {
    s.value = e.matches
  })
  return s
}

export const isCompact = watch('(max-width: 599px)')
/** List and detail side by side. */
export const isExpanded = watch('(min-width: 840px)')
