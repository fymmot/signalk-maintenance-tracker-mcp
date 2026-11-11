# Changelog

All notable changes to this plugin. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## 0.1.0

First public release.

### Web app

- The plugin serves its own web app (Signal K webapp) with everything the Skerry
  Android app does with maintenance: Work, Boat with search, part pages with their
  intervals and history, issues, seasons, events, checklists with a runner that saves
  every answer, the Log in season chapters, and photos with a viewer.
- An MCP page for connecting any AI assistant (Claude, ChatGPT, other MCP clients):
  the server's status and request counts, then the setup as four steps (a key, a
  public address, the connector address, a first request), and advanced settings.
  New secrets are shown once. It also offers a ready-made skill (`skill/SKILL.md`)
  that teaches the assistant to use the tools well, as a ZIP for Claude or as text.
- A first-run page that explains the app and creates a typical starter boat in one
  click, in English or Swedish. Until there is a season, Work asks for launch and
  haulout dates.
- Material 3 Expressive, matching the chart-auto-routing planner and Skerry. A bottom
  bar on phones, a rail on tablets, list and details side by side from 840 px. Light
  and dark, English and Swedish. Nothing loads from the internet.

### Maintenance model

- Boat as a shallow tree: system → component → part, one YAML file per record.
- Service triggers that fire on whichever comes first: calendar time, engine hours,
  trip count, a deadline relative to launch or haulout, or a fixed expiry date printed
  on the item (flares, extinguishers, life-jacket cartridges).
- Seasons (launch and haulout dates) that anchor pre- and post-season deadlines. A
  season task done early or late counts toward its milestone. A season task made
  before any season was entered doesn't count launches and haulouts from before it
  existed as missed.
- A starter boat laid out as an example: three levels, jobs named for what you do,
  hours and calendar intervals together, season jobs and expiry dates, and fees and
  insurance to show it holds more than maintenance.
- Defect register with severity, a fix-by milestone and a history of updates.
- Checklist templates with sections and schedules, and runs with pass or fail per item.
- Boat events (bought the boat, moved home port) and a merged timeline of jobs,
  events, milestones and checklist runs.
- Snooze for a single trigger's notification.

### Signal K

- `notifications.maintenance.<node>.<trigger>` deltas when a job is due (`warn`) or
  overdue (`alarm`), re-checked hourly and whenever engine hours change.
- REST API under `/plugins/signalk-maintenance-tracker-mcp/`, described by an OpenAPI
  document in the server's Admin UI. Reads are open to read-only users and writes to
  read-write users (Signal K 2.x).
- `GET /work`: the Work list, grouped on the server so every client shows the same.
- `GET /status` (admins): git backup state, current readings and the MCP server's
  state and counters, without secrets.

### Claude (MCP)

- Built-in MCP server on its own port, behind a Bearer token or a URL secret. It
  starts only once a token is set.
- 33 tools that run the same handlers as the REST API, with read-only hints on the
  read tools and instructions that keep log entries short.
- Photo panel (MCP Apps): take or pick photos in the chat, shrunk and stripped of
  EXIF and GPS data before upload, then attach them to components, issues, service
  jobs, events or checklist results.

### Storage

- Every change is a git commit in the plugin's data directory, with an optional
  debounced push to a private remote for off-board backup.
- Atomic writes (temp file, fsync, rename), schema validation and referential checks.
- The data directory is always a repository of its own, even inside another one (a
  `~/.signalk` kept under git).
- Creating a node never replaces another: a name used twice gets a new id, and a
  taken id answers 409. A node with children is deleted only with `recursive=true`.
- `GET/POST /starter-boat`: the starter tree, created once (existing ids are kept).
  `scripts/seed.mjs` uses it; `scripts/doctor.mjs` checks a datastore.

### Robustness

- Starts with an empty configuration and no network.
- REST routes keep working after the plugin is enabled at runtime or restarted with a
  new configuration.
- `stop()` waits for the MCP port to close and a pending backup push to finish.
- A port already in use shows as a plugin error instead of a silent failure.
