import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { McpState, PluginStatus } from '../../../../src/types'
import { readPluginOptions, savePluginOptions } from '../../api/client'
import { Icon, type IconName } from '../../components/Icon'
import { AppBar, Banner, CopyButton, Section, SwitchRow, TextField, snackbar, type Tone } from '../../components/ui'
import { t, type MessageKey } from '../../i18n'
import { formatNumber, formatRelative } from '../../lib/format'
import { download, zipBytes } from '../../lib/zip'
import { isAdmin, refreshStatus, status } from '../../state/store'
import skillText from '../../../../skill/SKILL.md?raw'
import { DestinationActions } from '../common'

/*
 * MCP: connect an AI assistant (Claude, ChatGPT, any MCP client) to the maintenance
 * plan. A status card, then the setup as four numbered steps in the order they are
 * done: a key, a public address, the connector, a first request. Each step saves what
 * it needs through Signal K's plugin config (admins only), which restarts the plugin.
 * Secrets are never read back for display: a new key or private address is shown once.
 */

const STATE_LOOK: Record<McpState | 'stopped', { icon: IconName; tone: Tone; title: MessageKey; body: MessageKey }> = {
  running: { icon: 'checkCircle', tone: 'primary', title: 'mcp.state.running', body: 'mcp.state.runningBody' },
  off: { icon: 'circle', tone: undefined, title: 'mcp.state.off', body: 'mcp.state.offBody' },
  needsToken: { icon: 'plug', tone: undefined, title: 'mcp.state.needsToken', body: 'mcp.state.needsTokenBody' },
  starting: { icon: 'pending', tone: 'tertiary', title: 'mcp.state.starting', body: 'mcp.state.startingBody' },
  error: { icon: 'errorCircle', tone: 'error', title: 'mcp.state.error', body: 'mcp.state.errorBody' },
  stopped: { icon: 'circle', tone: undefined, title: 'mcp.state.stopped', body: 'error.stopped' }
}

function randomSecret(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Changes only the MCP part of the plugin's saved options; Signal K then restarts it. */
async function saveMcp(patch: Record<string, unknown>): Promise<void> {
  const options = await readPluginOptions()
  const configuration = { ...(options.configuration ?? {}) }
  configuration.mcp = { ...((configuration.mcp ?? {}) as Record<string, unknown>), ...patch }
  await savePluginOptions({ ...options, enabled: true, configuration })
  // The plugin restarts; look again once it has.
  setTimeout(() => void refreshStatus(), 1200)
  setTimeout(() => void refreshStatus(), 3500)
}

function StatusCard({ s }: { s: PluginStatus }) {
  const mcp = s.mcp
  const look = STATE_LOOK[!s.running || !mcp ? 'stopped' : mcp.state]
  const runtime = mcp?.runtime
  const tone = look.tone
  return (
    <div class={`card ${tone === 'error' ? 'card-error' : tone === 'primary' ? 'card-primary' : 'card-filled'}`}>
      <div class="row" style={{ gap: '16px', alignItems: 'flex-start' }}>
        <Icon name={look.icon} />
        <div class="grow stack" style={{ '--stack-gap': '4px' }}>
          <p class="title-l emph">{t(look.title)}</p>
          <p class="body-m">{t(look.body, { port: String(mcp?.port ?? ''), error: runtime?.lastError ?? '' })}</p>
        </div>
      </div>
      {runtime && (
        <>
          <div class="tiles" style={{ marginTop: '16px' }}>
            <div class="tile" style={{ cursor: 'default' }}>
              <span class="tile-value">{formatNumber(runtime.requestCount, 0)}</span>
              <span class="tile-label">{t('mcp.requests')}</span>
              <span class="fine">{runtime.lastRequestAt ? formatRelative(runtime.lastRequestAt) : t('mcp.none')}</span>
            </div>
            <div class="tile" style={{ cursor: 'default' }} title={t('mcp.rejectedHint')}>
              <span class="tile-value">{formatNumber(runtime.unauthorizedCount, 0)}</span>
              <span class="tile-label">{t('mcp.rejected')}</span>
              <span class="fine">{runtime.lastUnauthorizedAt ? formatRelative(runtime.lastUnauthorizedAt) : t('mcp.none')}</span>
            </div>
          </div>
          <p class="body-m" style={{ marginTop: '12px' }}>
            {runtime.dnsRebindingProtection ? t('mcp.dnsOn', { hosts: runtime.allowedHosts.join(', ') }) : t('mcp.dnsOff')}
            {runtime.startedAt && <> · {t('mcp.since', { time: formatRelative(runtime.startedAt) })}</>}
          </p>
        </>
      )}
    </div>
  )
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ComponentChildren }) {
  return (
    <li class={`setup-step${done ? ' is-done' : ''}`}>
      <span class="setup-num" aria-hidden="true">
        {done ? <Icon name="check" /> : n}
      </span>
      <div class="grow stack" style={{ '--stack-gap': '10px' }}>
        <h3 class="title-m">
          {title}
          {done && <span class="visually-hidden"> ({t('mcp.stepDone')})</span>}
        </h3>
        {children}
      </div>
    </li>
  )
}

/**
 * The ready-made skill (skill/SKILL.md in the repo): how an assistant should use the
 * tools. A ZIP for Claude, which wants the folder at the top level; plain text for the
 * rest, which take it as instructions. Shown to everyone: it holds no secrets.
 */
function SkillSection() {
  return (
    <Section title={t('mcp.skill.title')}>
      <div class="card stack">
        <p class="body-m">{t('mcp.skill.body')}</p>
        <div class="button-row">
          <button
            type="button"
            class="btn btn-filled"
            onClick={() => download('boat-maintenance.zip', zipBytes([{ path: 'boat-maintenance/SKILL.md', text: skillText }]), 'application/zip')}
          >
            <Icon name="download" />
            {t('mcp.skill.download')}
          </button>
          <CopyButton text={skillText} label={t('mcp.skill.copy')} />
        </div>
        <details class="disclosure">
          <summary class="label-l">{t('mcp.skill.show')}</summary>
          <pre class="code skill-text">{skillText}</pre>
        </details>
      </div>
    </Section>
  )
}

export function McpScreen() {
  const s = status.value
  const admin = isAdmin.value
  // Secrets made during this visit, shown once.
  const [newKey, setNewKey] = useState<string>()
  const [newSecret, setNewSecret] = useState<string>()
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [port, setPort] = useState<string | null>(null)
  const [hosts, setHosts] = useState<string | null>(null)

  useEffect(() => {
    void refreshStatus()
    const id = setInterval(() => void refreshStatus(), 10_000)
    return () => clearInterval(id)
  }, [])

  const save = async (what: string, patch: Record<string, unknown>, after?: () => void) => {
    setBusy(what)
    try {
      await saveMcp(patch)
      after?.()
      snackbar(t('mcp.saved'))
    } catch {
      snackbar(t('mcp.saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  const body = () => {
    const mcp = s?.mcp
    if (!s || !mcp) return <Banner icon="info">{admin ? t('common.loading') : t('mcp.adminOnly')}</Banner>
    const publicUrl = mcp.publicUrl
    const urlDraft = url ?? publicUrl ?? ''
    const urlTrim = urlDraft.trim().replace(/\/+$/, '')
    const urlError = urlTrim && !/^https:\/\/[^\s/]+/.test(urlTrim) ? t('mcp.urlInvalid') : undefined
    const keyDone = mcp.enabled && mcp.tokenSet
    const lastRequestAt = mcp.runtime?.lastRequestAt
    const portDraft = port ?? String(mcp.port)
    const portN = Number(portDraft)
    const portError = Number.isInteger(portN) && portN >= 1024 && portN <= 65535 ? undefined : t('mcp.portInvalid')
    const hostsDraft = hosts ?? mcp.allowedHosts.join(', ')
    let publicHost: string | undefined
    try {
      publicHost = publicUrl ? new URL(publicUrl).host : undefined
    } catch {
      publicHost = undefined
    }
    const target = `http://${location.hostname}:${mcp.port}`

    const newKeyAndSave = (enable: boolean) => {
      const key = randomSecret(32)
      void save('key', enable ? { enabled: true, inboundToken: key } : { inboundToken: key }, () => setNewKey(key))
    }
    const newSecretAndSave = () => {
      const secret = randomSecret(24)
      void save('secret', { urlSecret: secret }, () => setNewSecret(secret))
    }

    return (
      <>
        <StatusCard s={s} />
        {!admin && <p class="body-m muted">{t('mcp.adminOnly')}</p>}

        <Section title={t('mcp.setup')}>
          <ol class="setup-steps">
            <Step n={1} title={t('mcp.step1.title')} done={keyDone}>
              <p class="body-m muted">{keyDone ? t('mcp.step1.done') : t('mcp.step1.body')}</p>
              {newKey && (
                <div class="banner tone-tertiary">
                  <Icon name="key" />
                  <div class="grow stack" style={{ '--stack-gap': '8px' }}>
                    <p class="title-s">{t('mcp.step1.newKey')}</p>
                    <code class="code">{newKey}</code>
                    <p class="body-m">{t('mcp.step1.newKeyHint')}</p>
                    <div>
                      <CopyButton text={newKey} />
                    </div>
                  </div>
                </div>
              )}
              {admin && !keyDone && (
                <div>
                  <button type="button" class="btn btn-filled" disabled={!!busy} onClick={() => newKeyAndSave(true)}>
                    <Icon name="key" />
                    {busy === 'key' ? t('mcp.saving') : t('mcp.step1.create')}
                  </button>
                </div>
              )}
              {admin && keyDone && !newKey && (
                <details class="disclosure">
                  <summary>{t('mcp.step1.rotate')}</summary>
                  <div class="stack" style={{ '--stack-gap': '8px' }}>
                    <p class="body-m muted">{t('mcp.step1.rotateHint')}</p>
                    <div>
                      <button type="button" class="btn btn-tonal btn-s" disabled={!!busy} onClick={() => newKeyAndSave(false)}>
                        <Icon name="key" />
                        {busy === 'key' ? t('mcp.saving') : t('mcp.step1.rotate')}
                      </button>
                    </div>
                  </div>
                </details>
              )}
            </Step>

            <Step n={2} title={t('mcp.step2.title')} done={!!publicUrl}>
              <p class="body-m muted">
                {publicUrl ? t('mcp.step2.done', { url: publicUrl }) : t('mcp.step2.body', { port: String(mcp.port) })}
              </p>
              <div class="field-group">
                <span class="field-label">{t('mcp.step2.target')}</span>
                <code class="code">{target}</code>
              </div>
              {admin && (
                <form
                  class="row wrap"
                  style={{ alignItems: 'flex-end', gap: '12px' }}
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (urlError || !urlTrim) return
                    void save('url', { publicUrl: urlTrim }, () => setUrl(null))
                  }}
                >
                  <div class="grow" style={{ minWidth: '220px' }}>
                    <TextField
                      label={t('mcp.step2.field')}
                      type="url"
                      inputMode="url"
                      placeholder="https://maintenance.example.com"
                      value={urlDraft}
                      onInput={setUrl}
                      error={urlError}
                    />
                  </div>
                  <button type="submit" class="btn btn-tonal" disabled={!!busy || !urlTrim || !!urlError || urlTrim === publicUrl}>
                    {busy === 'url' ? t('mcp.saving') : t('mcp.step2.save')}
                  </button>
                </form>
              )}
            </Step>

            <Step n={3} title={t('mcp.step3.title')} done={!!lastRequestAt}>
              {!publicUrl ? (
                <p class="body-m muted">{t('mcp.step3.needsUrl')}</p>
              ) : (
                <>
                  <p class="body-m muted">{t('mcp.step3.body')}</p>
                  <div class="card card-outlined stack" style={{ '--stack-gap': '8px' }}>
                    <p class="title-s">{t('mcp.step3.header')}</p>
                    <code class="code">{`${publicUrl}/mcp`}</code>
                    <p class="fine">{t('mcp.step3.headerHint')}</p>
                    <div>
                      <CopyButton text={`${publicUrl}/mcp`} />
                    </div>
                  </div>
                  <div class="card card-outlined stack" style={{ '--stack-gap': '8px' }}>
                    <p class="title-s">{t('mcp.step3.secret')}</p>
                    <p class="fine">{t('mcp.step3.secretHint')}</p>
                    {newSecret ? (
                      <>
                        <code class="code">{`${publicUrl}/mcp/${newSecret}`}</code>
                        <div>
                          <CopyButton text={`${publicUrl}/mcp/${newSecret}`} />
                        </div>
                      </>
                    ) : (
                      mcp.urlSecretSet && <p class="body-m muted">{t('mcp.step3.secretHidden')}</p>
                    )}
                    {admin && (
                      <div class="button-row">
                        <button type="button" class="btn btn-tonal btn-s" disabled={!!busy} onClick={newSecretAndSave}>
                          <Icon name="link" />
                          {busy === 'secret' ? t('mcp.saving') : t('mcp.step3.makeSecret')}
                        </button>
                        {mcp.urlSecretSet && (
                          <button
                            type="button"
                            class="btn btn-text btn-danger"
                            disabled={!!busy}
                            onClick={() => void save('secret', { urlSecret: '' }, () => setNewSecret(undefined))}
                          >
                            {t('mcp.step3.removeSecret')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </Step>

            <Step n={4} title={t('mcp.step4.title')} done={!!lastRequestAt}>
              <p class="body-m muted" role="status">
                {lastRequestAt ? t('mcp.step4.done', { time: formatRelative(lastRequestAt) }) : t('mcp.step4.waiting')}
              </p>
            </Step>
          </ol>
        </Section>

        {admin && (
          <details class="disclosure card">
            <summary class="title-m">{t('mcp.advanced')}</summary>
            <form
              class="stack"
              onSubmit={(e) => {
                e.preventDefault()
                if (portError) return
                void save('adv', { port: portN, allowedHosts: hostsDraft }, () => {
                  setPort(null)
                  setHosts(null)
                })
              }}
            >
              <SwitchRow
                label={t('mcp.enabled')}
                hint={t('mcp.enabledHint')}
                checked={mcp.enabled}
                disabled={!!busy}
                onChange={(enabled) => void save('enabled', { enabled })}
              />
              <div class="field-row">
                <TextField label={t('mcp.port')} type="number" inputMode="numeric" value={portDraft} onInput={setPort} error={portError} />
              </div>
              <TextField label={t('mcp.allowedHosts')} hint={t('mcp.allowedHostsHint')} value={hostsDraft} onInput={setHosts} />
              {publicHost && !hostsDraft.includes(publicHost) && (
                <div>
                  <button type="button" class="chip" onClick={() => setHosts(hostsDraft ? `${hostsDraft}, ${publicHost}` : publicHost)}>
                    <Icon name="add" />
                    {t('mcp.useHost', { host: publicHost })}
                  </button>
                </div>
              )}
              <div class="button-row" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" class="btn btn-filled" disabled={!!busy || !!portError}>
                  {busy === 'adv' ? t('mcp.saving') : t('mcp.saveAdvanced')}
                </button>
              </div>
            </form>
          </details>
        )}
      </>
    )
  }

  return (
    <div>
      <AppBar title={t('mcp.title')} actions={<DestinationActions />} />
      <div class="pane-inner">
        <p class="body-l muted">{t('mcp.intro')}</p>
        {body()}
        <SkillSection />
      </div>
    </div>
  )
}
