import { FILLED_PATHS, ICON_PATHS } from './icons.gen'

/*
 * Material Symbols Rounded (weight 400), generated into icons.gen.ts by tools/icons.mjs,
 * drawn in currentColor. `filled` swaps in the filled style where one is generated (the
 * current navigation destination). Decorative by default; pass `label` when the icon is
 * the only name a control has.
 */

export type IconName = keyof typeof ICON_PATHS

export function Icon({ name, label, filled, class: cls }: { name: IconName; label?: string; filled?: boolean; class?: string }) {
  return (
    <svg
      class={`icon${cls ? ` ${cls}` : ''}`}
      viewBox="0 -960 960 960"
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      <path d={(filled && FILLED_PATHS[name]) || ICON_PATHS[name]} />
    </svg>
  )
}
