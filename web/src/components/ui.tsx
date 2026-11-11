import { signal } from '@preact/signals'
import { createContext, type ComponentChildren, type RefObject } from 'preact'
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { t } from '../i18n'
import { goBack, hrefFor } from '../lib/router'
import type { Crumb } from '../lib/trail'
import { Icon, type IconName } from './Icon'

/* ---- Top app bar ------------------------------------------------------------------ */

/**
 * The heading level app bars use: 1 normally, 2 in the detail pane when it sits beside
 * the list, so a page has one h1.
 */
export const HeadingLevel = createContext<1 | 2>(1)

/**
 * A pane's top bar. It turns a step darker once the pane scrolls, so the title stays
 * readable over content. `back` shows a back arrow (hidden in a split view by the caller).
 * `trail` is the breadcrumb above the title: the places this page sits under.
 */
export function AppBar({
  title,
  subtitle,
  trail,
  back,
  actions,
  headingLevel
}: {
  title: string
  subtitle?: string
  trail?: Crumb[]
  back?: boolean | (() => void)
  actions?: ComponentChildren
  headingLevel?: 1 | 2
}) {
  const ref = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const pane = ref.current?.closest('.pane')
    if (!pane) return
    const onScroll = () => setScrolled(pane.scrollTop > 4)
    pane.addEventListener('scroll', onScroll, { passive: true })
    return () => pane.removeEventListener('scroll', onScroll)
  }, [])
  const inherited = useContext(HeadingLevel)
  const level = headingLevel ?? inherited
  const H = level === 1 ? 'h1' : 'h2'
  return (
    <header ref={ref} class={`app-bar${scrolled ? ' is-scrolled' : ''}`}>
      {back && (
        <button type="button" class="icon-btn" onClick={typeof back === 'function' ? back : goBack} aria-label={t('nav.back')}>
          <Icon name="back" />
        </button>
      )}
      <div class="grow app-bar-text">
        {trail && trail.length > 0 && <Breadcrumbs trail={trail} />}
        <H class="app-bar-title" tabIndex={-1} data-route-heading>
          {title}
        </H>
        {subtitle && <span class="app-bar-sub">{subtitle}</span>}
      </div>
      {actions}
    </header>
  )
}

/**
 * One line of links, nearest last. When it is too long, the outer crumbs shrink first
 * and end in an ellipsis; the link keeps its full name for screen readers and on hover.
 */
function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav class="crumbs" aria-label={t('nav.breadcrumb')}>
      <ol>
        {trail.map((c, i) => (
          <li>
            {i > 0 && <Icon name="chevron" />}
            <a href={hrefFor(c.route)} title={c.label}>
              {c.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

/* ---- Sections and lists ------------------------------------------------------------ */

export function Section({
  title,
  trailing,
  id,
  children
}: {
  title?: string
  trailing?: ComponentChildren
  id?: string
  children: ComponentChildren
}) {
  return (
    <section class="section" id={id}>
      {title && (
        <div class="section-head">
          <h2 class="section-title" tabIndex={-1}>
            {title}
          </h2>
          {trailing}
        </div>
      )}
      {children}
    </section>
  )
}

export type Tone = 'error' | 'tertiary' | 'primary' | 'ok' | undefined

/**
 * One row of a segmented list. With `href` or `onClick` the whole row is one control;
 * `trailing` puts a second control (a check button, a menu) beside it.
 */
export function Row({
  icon,
  tone,
  title,
  sub,
  overline,
  meta,
  href,
  onClick,
  current,
  trailing,
  lead
}: {
  icon?: IconName
  tone?: Tone
  title: ComponentChildren
  sub?: ComponentChildren
  overline?: ComponentChildren
  meta?: ComponentChildren
  href?: string
  onClick?: () => void
  current?: boolean
  trailing?: ComponentChildren
  lead?: ComponentChildren
}) {
  const leading = lead ?? (icon && (
    <span class={`li-lead${tone ? ` tone-${tone}` : ''}`}>
      <Icon name={icon} />
    </span>
  ))
  const body = (
    <>
      {leading}
      <span class="li-body">
        {overline && <span class="li-overline">{overline}</span>}
        <span class="li-title">{title}</span>
        {sub && <span class="li-sub">{sub}</span>}
      </span>
      {meta && <span class="li-trail">{meta}</span>}
      {(href || onClick) && !trailing && <Icon name="chevron" class="li-trail" />}
    </>
  )
  const main = href ? (
    <a class="li-btn" href={href} aria-current={current ? 'true' : undefined}>
      {body}
    </a>
  ) : onClick ? (
    <button type="button" class="li-btn" onClick={onClick} aria-current={current ? 'true' : undefined}>
      {body}
    </button>
  ) : (
    <div class="li">{body}</div>
  )
  return (
    <li>
      {trailing ? (
        <div class="li-shell">
          {main}
          {trailing}
        </div>
      ) : (
        main
      )}
    </li>
  )
}

export function List({ children, label, class: cls }: { children: ComponentChildren; label?: string; class?: string }) {
  return (
    <ul class={`list${cls ? ` ${cls}` : ''}`} aria-label={label}>
      {children}
    </ul>
  )
}

/* ---- States ------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  body,
  action
}: {
  icon: IconName
  title: string
  body?: string
  action?: ComponentChildren
}) {
  return (
    <div class="empty">
      <span class="empty-art">
        <Icon name={icon} />
      </span>
      <p class="title-l">{title}</p>
      {body && <p class="body-m muted">{body}</p>}
      {action}
    </div>
  )
}

/** A loading indicator that waits 150 ms, so a quick answer never flashes it. */
export function Loading({ label }: { label?: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 150)
    return () => clearTimeout(id)
  }, [])
  return (
    <div class="center-fill" role="status" aria-live="polite">
      {show && (
        <div class="stack" style={{ alignItems: 'center', '--stack-gap': '12px' }}>
          <span class="loader loader-l" aria-hidden="true" />
          <span class="body-m muted">{label ?? t('common.loading')}</span>
        </div>
      )}
    </div>
  )
}

export function Banner({
  tone,
  icon = 'info',
  children,
  action
}: {
  tone?: 'error' | 'tertiary'
  icon?: IconName
  children: ComponentChildren
  action?: ComponentChildren
}) {
  return (
    <div class={`banner${tone ? ` tone-${tone}` : ''}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={icon} />
      <div class="grow stack" style={{ '--stack-gap': '8px' }}>
        {children}
        {action && <div class="button-row">{action}</div>}
      </div>
    </div>
  )
}

export function Pill({ tone, icon, children }: { tone?: Tone; icon?: IconName; children: ComponentChildren }) {
  return (
    <span class={`pill${tone ? ` tone-${tone}` : ''}`}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  )
}

/* ---- Dialogs and sheets --------------------------------------------------------------- */

/**
 * A native modal <dialog>: the browser traps focus, Escape closes it, and focus goes
 * back to what opened it.
 */
function useModal(onClose: () => void): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (!d.open) d.showModal()
    const close = () => onClose()
    d.addEventListener('close', close)
    return () => {
      d.removeEventListener('close', close)
      if (d.open) d.close()
    }
  }, [])
  return ref
}

export function Dialog({
  title,
  children,
  actions,
  onClose,
  role = 'dialog'
}: {
  title: string
  children?: ComponentChildren
  actions: ComponentChildren
  onClose: () => void
  role?: 'dialog' | 'alertdialog'
}) {
  const ref = useModal(onClose)
  const titleId = useId()
  const bodyId = useId()
  return (
    <dialog ref={ref} class="m3-dialog" aria-labelledby={titleId} aria-describedby={children ? bodyId : undefined} role={role}>
      <h2 class="dialog-title" id={titleId}>
        {title}
      </h2>
      {children && (
        <div class="body-m muted stack" id={bodyId}>
          {children}
        </div>
      )}
      <div class="dialog-actions">{actions}</div>
    </dialog>
  )
}

export function ConfirmDialog({
  title,
  body,
  confirm,
  danger,
  onConfirm,
  onClose
}: {
  title: string
  body?: string
  confirm: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title={title}
      role="alertdialog"
      onClose={onClose}
      actions={
        <>
          <button type="button" class="btn btn-text" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            class={`btn ${danger ? 'btn-filled btn-danger' : 'btn-filled'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onClose()
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirm}
          </button>
        </>
      }
    >
      {body && <p>{body}</p>}
    </Dialog>
  )
}

/**
 * An editor: a side sheet from the end edge, full screen on phones. The form inside
 * owns submit; `footer` holds its buttons.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  onSubmit
}: {
  title: string
  onClose: () => void
  children: ComponentChildren
  footer: ComponentChildren
  onSubmit: () => void
}) {
  const ref = useModal(onClose)
  const titleId = useId()
  return (
    <dialog ref={ref} class="sheet" aria-labelledby={titleId}>
      <form
        method="dialog"
        class="stack"
        style={{ '--stack-gap': '0', height: '100%' }}
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
          focusFirstInvalid(e.currentTarget as HTMLElement)
        }}
        noValidate
      >
        <div class="sheet-head">
          <button type="button" class="icon-btn" onClick={() => ref.current?.close()} aria-label={t('nav.close')}>
            <Icon name="close" />
          </button>
          <h2 id={titleId}>{title}</h2>
        </div>
        <div class="sheet-body">{children}</div>
        <div class="sheet-foot">{footer}</div>
      </form>
    </dialog>
  )
}

/**
 * After a submit that failed validation, focus the first field marked invalid, so
 * the error is read out instead of nothing happening.
 */
export function focusFirstInvalid(form: HTMLElement): void {
  requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
}

/* ---- Menu --------------------------------------------------------------------------- */

export interface MenuItem {
  label: string
  icon?: IconName
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

/** An overflow menu: arrow keys move, Escape closes and returns focus to the button. */
export function OverflowMenu({ items, label }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const first = menu.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')
    first?.focus()
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const onKey = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus()
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus()
    else if (e.key === 'Home') items[0]?.focus()
    else if (e.key === 'End') items[items.length - 1]?.focus()
    else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false)
      if (e.key === 'Escape') button.current?.focus()
      return
    } else return
    e.preventDefault()
  }

  return (
    <div class="menu-anchor">
      <button
        ref={button}
        type="button"
        class="icon-btn"
        aria-label={label ?? t('nav.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div ref={menu} id={menuId} class="menu" role="menu" onKeyDown={onKey}>
          {items.map((item) => (
            <button
              type="button"
              role="menuitem"
              class={`menu-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                button.current?.focus()
                item.onSelect()
              }}
            >
              {item.icon && <Icon name={item.icon} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---- Snackbar ------------------------------------------------------------------------ */

interface Snack {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

const snackState = signal<Snack | null>(null)
let snackId = 0

/** Shows a short message at the bottom; a new one replaces the last. */
export function snackbar(text: string, action?: Snack['action']): void {
  snackState.value = { id: ++snackId, text, action }
}

/**
 * The snackbar is a manual popover, so it is drawn in the top layer: above an open
 * sheet or the photo viewer, and not made inert by them.
 */
export function SnackbarHost() {
  const snack = snackState.value
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!snack || !el) return
    try {
      // Re-show so it lands above whatever opened since.
      if (el.matches(':popover-open')) el.hidePopover()
      el.showPopover()
    } catch {
      /* no popover support: it still shows, fixed at the bottom */
    }
    const id = setTimeout(() => {
      if (snackState.value?.id === snack.id) snackState.value = null
    }, snack.action ? 8000 : 4000)
    return () => clearTimeout(id)
  }, [snack?.id])
  return (
    <div>
      {snack && (
        <div class="snackbar" ref={ref} popover="manual" role="status" aria-live="polite" aria-atomic="true">
          <span class="grow">{snack.text}</span>
          {snack.action && (
            <button
              type="button"
              class="btn btn-text"
              onClick={() => {
                snack.action?.run()
                snackState.value = null
              }}
            >
              {snack.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ---- Form fields ------------------------------------------------------------------- */

interface FieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
}

function FieldFrame({ label, hint, error, id, children }: FieldProps & { id: string; children: ComponentChildren }) {
  return (
    <div class="field-group">
      <label class="field-label" for={id}>
        {label}
      </label>
      {children}
      {error ? (
        <span class="field-hint error-text" id={`${id}-msg`}>
          {error}
        </span>
      ) : (
        hint && (
          <span class="field-hint" id={`${id}-msg`}>
            {hint}
          </span>
        )
      )}
    </div>
  )
}

export function TextField({
  label,
  hint,
  error,
  required,
  value,
  onInput,
  type = 'text',
  inputMode,
  placeholder,
  autoComplete,
  multiline,
  min,
  max,
  step,
  autoFocus
}: FieldProps & {
  value: string
  onInput: (v: string) => void
  type?: 'text' | 'number' | 'date' | 'url' | 'password' | 'search' | 'datetime-local' | 'month'
  inputMode?: 'text' | 'decimal' | 'numeric' | 'url'
  placeholder?: string
  autoComplete?: string
  multiline?: boolean
  min?: string | number
  max?: string | number
  step?: string | number
  autoFocus?: boolean
}) {
  const id = useId()
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  // The autofocus attribute only works on load or when a dialog opens; a field that
  // appears later (a caption box, a step in an editor) takes focus here.
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [])
  const common = {
    id,
    ref,
    class: 'field',
    value,
    required,
    placeholder,
    autoFocus,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': error || hint ? `${id}-msg` : undefined,
    onInput: (e: Event) => onInput((e.currentTarget as HTMLInputElement).value)
  } as const
  return (
    <FieldFrame label={label} hint={hint} error={error} id={id}>
      {multiline ? (
        <textarea {...common} rows={4} />
      ) : (
        <input {...common} type={type as 'text'} inputMode={inputMode} autoComplete={autoComplete} min={min} max={max} step={step} />
      )}
    </FieldFrame>
  )
}

export function SelectField<T extends string>({
  label,
  hint,
  error,
  value,
  options,
  onChange
}: FieldProps & { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  const id = useId()
  return (
    <FieldFrame label={label} hint={hint} error={error} id={id}>
      <select
        id={id}
        class="field"
        value={value}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value as T)}
      >
        {options.map((o) => (
          <option value={o.value}>{o.label}</option>
        ))}
      </select>
    </FieldFrame>
  )
}

/** A labelled switch row; the whole row toggles it. */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  const id = useId()
  return (
    <div class="row" style={{ gap: '16px', minHeight: '56px' }}>
      <label class="grow" for={id}>
        <span class="body-l" style={{ display: 'block' }}>
          {label}
        </span>
        {hint && (
          <span class="body-m muted" id={`${id}-hint`}>
            {hint}
          </span>
        )}
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        class="m3-switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
    </div>
  )
}

/** A connected button group for one choice among a few. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string; lang?: string }>
  onChange: (v: T) => void
}) {
  return (
    <div class="button-group" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" class="seg" lang={o.lang} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Copies text and says so. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      class="btn btn-tonal btn-s"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 2000)
        } catch {
          snackbar(t('error.save'))
        }
      }}
    >
      <Icon name={done ? 'check' : 'copy'} />
      {done ? t('common.copied') : (label ?? t('common.copy'))}
    </button>
  )
}
