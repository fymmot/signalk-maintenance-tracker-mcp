import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { signInNeeded } from '../api/client'
import { t, tn, type MessageKey } from '../i18n'
import { isExpanded } from '../lib/media'
import { destination, isDetail, navigate, route, type Destination, type Route } from '../lib/router'
import { focusedNodeId, openEditor } from '../state/editors'
import { canWrite, loading, nodes, unavailable, work } from '../state/store'
import { Icon, type IconName } from './Icon'
import { SignInDialog } from './SignIn'
import { HeadingLevel, SnackbarHost } from './ui'

const PRIMARY: Array<{ dest: Destination; icon: IconName; label: MessageKey }> = [
  { dest: 'work', icon: 'wrench', label: 'nav.work' },
  { dest: 'boat', icon: 'boat', label: 'nav.boat' },
  { dest: 'checklists', icon: 'checklist', label: 'nav.checklists' },
  { dest: 'log', icon: 'log', label: 'nav.log' },
  { dest: 'mcp', icon: 'plug', label: 'nav.mcp' }
]

function NavItem({ dest, icon, label }: { dest: Destination; icon: IconName; label: MessageKey }) {
  const current = destination.value === dest
  const badge = dest === 'work' ? (work.value?.badgeCount ?? 0) : 0
  return (
    <a
      class="nav-item"
      href={`#/${dest}`}
      aria-current={current ? 'page' : undefined}
      aria-label={badge ? `${t(label)}, ${tn('nav.workBadge', badge)}` : undefined}
    >
      <span class="nav-ind">
        <Icon name={icon} filled={current} />
        {badge > 0 && (
          <span class="badge nav-badge" aria-hidden="true">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span class="nav-label" aria-hidden={badge ? 'true' : undefined}>
        {t(label)}
      </span>
    </a>
  )
}

/** "Job done", "Problem found", "Note": the Expressive FAB menu. */
function CaptureMenu({ extended }: { extended?: boolean }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector<HTMLButtonElement>('.fab')?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (!canWrite.value) return null
  // Focus goes back to the FAB first, so it returns there when the editor closes.
  const pick = (run: () => void) => () => {
    setOpen(false)
    root.current?.querySelector<HTMLButtonElement>('.fab')?.focus()
    run()
  }
  const menuId = 'capture-menu'
  return (
    <div class="fab-menu" ref={root}>
      <button
        type="button"
        class={`fab${extended ? ' fab-extended' : ''}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={extended ? undefined : t('capture.menu')}
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'close' : 'add'} />
      </button>
      {open && (
        <div class="fab-menu-items" id={menuId} role="group" aria-label={t('capture.menu')}>
          <button
            type="button"
            class="fab-menu-item"
            onClick={pick(() => openEditor({ kind: 'service', nodeId: focusedNodeId.value }))}
          >
            <Icon name="check" />
            {t('capture.job')}
          </button>
          <button type="button" class="fab-menu-item" onClick={pick(() => openEditor({ kind: 'issue', nodeId: focusedNodeId.value }))}>
            <Icon name="warning" />
            {t('capture.problem')}
          </button>
          <button type="button" class="fab-menu-item" onClick={pick(() => navigate({ name: 'event' }))}>
            <Icon name="note" />
            {t('capture.note')}
          </button>
        </div>
      )}
    </div>
  )
}

const LIST_WIDTH_KEY = 'maintenance.listWidth'
const MIN_LIST = 320
const MAX_LIST = 560

function readListWidth(): number {
  try {
    const v = Number(localStorage.getItem(LIST_WIDTH_KEY))
    return v >= MIN_LIST && v <= MAX_LIST ? v : 420
  } catch {
    return 420
  }
}

/** The drag handle between list and detail; arrow keys move it too. */
function PaneDivider({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const [dragging, setDragging] = useState(false)
  const clamp = (w: number) => Math.max(MIN_LIST, Math.min(MAX_LIST, Math.round(w)))
  return (
    <div
      class={`pane-divider${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('nav.resizePanes')}
      aria-valuemin={MIN_LIST}
      aria-valuemax={MAX_LIST}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onWidth(clamp(width - step))
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onWidth(clamp(width + step))
        else if (e.key === 'Home') onWidth(MIN_LIST)
        else if (e.key === 'End') onWidth(MAX_LIST)
        else return
        e.preventDefault()
      }}
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLElement
        const left = (el.previousElementSibling as HTMLElement).getBoundingClientRect().left
        el.setPointerCapture(e.pointerId)
        setDragging(true)
        const move = (ev: PointerEvent) => onWidth(clamp(ev.clientX - left))
        const up = () => {
          setDragging(false)
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.removeEventListener('pointercancel', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      }}
    />
  )
}

/** Moves focus to the new screen's heading, so a screen reader announces where you are. */
function useRouteFocus(key: string) {
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = requestAnimationFrame(() => {
      // The last visible pane that has a heading: the detail, or the list beside a placeholder.
      const headings = [...document.querySelectorAll<HTMLElement>('.pane [data-route-heading]')].filter(
        (h) => h.offsetParent !== null && h.textContent?.trim()
      )
      headings[headings.length - 1]?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [key])
}

export function Shell({
  list,
  detail,
  fullPage
}: {
  list: (dest: Destination) => ComponentChildren
  detail: (r: Route) => ComponentChildren
  fullPage: (dest: Destination) => ComponentChildren
}) {
  const [listWidth, setListWidth] = useState(readListWidth)
  const r = route.value
  const dest = destination.value
  const showDetail = isDetail(r)
  // Full width for the pages without records, and for the first run, where there is
  // nothing yet to show beside the list.
  const firstRun = !loading.value && !unavailable.value && nodes.value.length === 0 && (dest === 'work' || dest === 'boat')
  const pageOnly = (dest === 'mcp' || dest === 'settings' || firstRun) && !showDetail
  useRouteFocus(`${r.name}:${'id' in r ? r.id : ''}`)

  useEffect(() => {
    try {
      localStorage.setItem(LIST_WIDTH_KEY, String(listWidth))
    } catch {
      /* private mode */
    }
  }, [listWidth])

  return (
    <div class="shell">
      <nav class="nav-rail" aria-label={t('nav.label')}>
        <div class="nav-rail-fab">
          <CaptureMenu />
        </div>
        {PRIMARY.map((p) => (
          <NavItem {...p} />
        ))}
        <div style={{ flex: 1 }} />
        <NavItem dest="settings" icon="settings" label="nav.settings" />
      </nav>

      <main class="shell-main">
        {pageOnly ? (
          <div class="panes">
            <section class="pane pane-list" key={dest}>
              {fullPage(dest)}
            </section>
          </div>
        ) : (
          <div
            class={`panes is-split${showDetail ? ' has-detail' : ''}`}
            style={{ '--list-width': `${listWidth}px` }}
          >
            {(isExpanded.value || !showDetail) && (
              <section class="pane pane-list" key={`list-${dest}`}>
                {list(dest)}
              </section>
            )}
            {isExpanded.value && <PaneDivider width={listWidth} onWidth={setListWidth} />}
            {(isExpanded.value || showDetail) && (
              <section class="pane pane-detail" key={`detail-${r.name}-${'id' in r ? r.id : ''}`}>
                {showDetail ? (
                  <HeadingLevel.Provider value={isExpanded.value ? 2 : 1}>{detail(r)}</HeadingLevel.Provider>
                ) : (
                  <div class="detail-placeholder">
                    <p class="body-l">{t('common.selectToSee')}</p>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </main>

      <nav class="nav-bar" aria-label={t('nav.label')}>
        {PRIMARY.map((p) => (
          <NavItem {...p} />
        ))}
      </nav>
      {/* On phones the FAB belongs to the destinations, not to a record's page. */}
      {!showDetail && (
        <div class="fab-dock">
          <CaptureMenu />
        </div>
      )}

      <SnackbarHost />
      {signInNeeded.value && <SignInDialog onClose={() => (signInNeeded.value = false)} />}
    </div>
  )
}
