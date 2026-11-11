import { useEffect } from 'preact/hooks'
import { Shell } from './components/Shell'
import { EmptyState } from './components/ui'
import { EditorHost } from './editors/EditorHost'
import { t } from './i18n'
import type { Destination, Route } from './lib/router'
import { BoatScreen } from './screens/boat/BoatScreen'
import { ChecklistEditorScreen } from './screens/checklists/ChecklistEditorScreen'
import { ChecklistScreen, ChecklistsScreen } from './screens/checklists/ChecklistsScreen'
import { RunScreen } from './screens/checklists/RunScreen'
import { EventScreen, EventsScreen } from './screens/events/EventsScreen'
import { IssueScreen } from './screens/issues/IssueScreen'
import { IssuesScreen } from './screens/issues/IssuesScreen'
import { LogScreen } from './screens/log/LogScreen'
import { McpScreen } from './screens/mcp/McpScreen'
import { NodeScreen } from './screens/node/NodeScreen'
import { SeasonScreen, SeasonsScreen } from './screens/seasons/SeasonsScreen'
import { SettingsScreen } from './screens/settings/SettingsScreen'
import { WorkScreen } from './screens/work/WorkScreen'
import { refreshAll, refreshLogin } from './state/store'

/* The app: which screen goes in which pane, and keeping the data fresh. */

function ListPane({ dest }: { dest: Destination }) {
  switch (dest) {
    case 'work':
      return <WorkScreen />
    case 'boat':
      return <BoatScreen />
    case 'checklists':
      return <ChecklistsScreen />
    case 'log':
      return <LogScreen />
    case 'mcp':
      return <McpScreen />
    case 'settings':
      return <SettingsScreen />
  }
}

function DetailPane({ route: r }: { route: Route }) {
  switch (r.name) {
    case 'node':
      return <NodeScreen id={r.id} />
    case 'issues':
      return <IssuesScreen />
    case 'issue':
      return <IssueScreen id={r.id} />
    case 'seasons':
      return <SeasonsScreen />
    case 'season':
      return <SeasonScreen key={r.id ?? 'new'} id={r.id} />
    case 'events':
      return <EventsScreen />
    case 'event':
      return <EventScreen key={r.id ?? 'new'} id={r.id} />
    case 'checklist':
      return <ChecklistScreen id={r.id} />
    case 'checklistEdit':
      return <ChecklistEditorScreen key={r.id ?? 'new'} id={r.id} />
    case 'run':
      return <RunScreen key={r.id} id={r.id} />
    default:
      return <EmptyState icon="inbox" title={t('error.missing')} />
  }
}

export function App() {
  useEffect(() => {
    void refreshLogin()
    void refreshAll()
    // Pick up changes made in Claude or the phone app when the user comes back.
    const onFocus = () => {
      if (document.visibilityState === 'visible') void refreshAll()
    }
    document.addEventListener('visibilitychange', onFocus)
    const id = setInterval(() => void refreshAll(), 5 * 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onFocus)
      clearInterval(id)
    }
  }, [])

  return (
    <>
      <Shell
        list={(dest) => <ListPane dest={dest} />}
        detail={(r) => <DetailPane route={r} />}
        fullPage={(dest) => <ListPane dest={dest} />}
      />
      <EditorHost />
    </>
  )
}
