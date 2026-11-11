import { signal } from '@preact/signals'

/* Light, dark or the system's choice; stored per browser. index.html applies it before paint. */

export type Theme = 'auto' | 'light' | 'dark'
const KEY = 'maintenance.theme'

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export const theme = signal<Theme>(read())

export function setTheme(next: Theme): void {
  theme.value = next
  const root = document.documentElement
  if (next === 'auto') delete root.dataset.theme
  else root.dataset.theme = next
  try {
    if (next === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    /* private mode */
  }
}
