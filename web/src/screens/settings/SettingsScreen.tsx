import { useEffect } from 'preact/hooks'
import { pluginConfigUrl, signInNeeded } from '../../api/client'
import { Icon } from '../../components/Icon'
import { AppBar, Banner, List, Row, Section, Segmented } from '../../components/ui'
import { langPref, setLangPref, t, type LangPref } from '../../i18n'
import { formatNumber, formatRelative } from '../../lib/format'
import { isCompact } from '../../lib/media'
import { setTheme, theme, type Theme } from '../../lib/theme'
import { login, refreshLogin, refreshStatus, status } from '../../state/store'

/* Appearance and language for this browser; backup and readings from the server. */
export function SettingsScreen() {
  useEffect(() => {
    void refreshStatus()
    void refreshLogin()
  }, [])
  const s = status.value
  const git = s?.git
  const l = login.value

  return (
    <div>
      <AppBar title={t('settings.title')} back={isCompact.value} />
      <div class="pane-inner">
        <Section title={t('settings.appearance')}>
          <div class="card stack">
            <div class="field-group">
              <span class="field-label">{t('settings.theme')}</span>
              <Segmented<Theme>
                label={t('settings.theme')}
                value={theme.value}
                onChange={setTheme}
                options={[
                  { value: 'auto', label: t('settings.theme.auto') },
                  { value: 'light', label: t('settings.theme.light') },
                  { value: 'dark', label: t('settings.theme.dark') }
                ]}
              />
            </div>
            <div class="field-group">
              <span class="field-label">{t('settings.language')}</span>
              <Segmented<LangPref>
                label={t('settings.language')}
                value={langPref.value}
                onChange={setLangPref}
                options={[
                  { value: 'auto', label: t('settings.language.auto') },
                  { value: 'en', label: 'English', lang: 'en' },
                  { value: 'sv', label: 'Svenska', lang: 'sv' }
                ]}
              />
            </div>
          </div>
        </Section>

        <Section title={t('settings.account')}>
          {l?.status === 'loggedIn' && l.username ? (
            <List>
              <Row
                icon="login"
                title={t('auth.signedInAs', { name: l.username })}
                sub={l.userLevel ? t(`auth.level.${l.userLevel}`) : undefined}
              />
            </List>
          ) : l?.authenticationRequired === false ? null : (
            <div>
              <button type="button" class="btn btn-filled" onClick={() => (signInNeeded.value = true)}>
                <Icon name="login" />
                {t('settings.signIn')}
              </button>
            </div>
          )}
        </Section>

        {git && (
          <Section title={t('settings.backup')}>
            <p class="body-m muted">{t('settings.backupBody')}</p>
            <List>
              <Row
                icon={git.pushEnabled ? 'checkCircle' : 'cloudOff'}
                tone={git.pushEnabled ? 'primary' : undefined}
                title={t('settings.backupRemote')}
                sub={git.pushEnabled ? t('settings.backupRemoteOn') : t('settings.backupRemoteOff')}
              />
              {git.lastCommitAt && <Row icon="log" title={t('settings.lastCommit')} sub={formatRelative(git.lastCommitAt)} />}
              {git.lastPushAt && <Row icon="refresh" title={t('settings.lastPush')} sub={formatRelative(git.lastPushAt)} />}
            </List>
            {git.lastPushError && (
              <Banner tone="error" icon="warning">
                <p class="body-m">{t('settings.pushError', { error: git.lastPushError })}</p>
              </Banner>
            )}
          </Section>
        )}

        {s?.metrics && (
          <Section title={t('settings.readings')}>
            <List>
              <Row
                icon="engine"
                title={t('settings.engineHours')}
                sub={
                  s.metrics.engineHours !== undefined
                    ? `${formatNumber(s.metrics.engineHours)} h`
                    : t('settings.engineHoursNone', { path: s.metrics.engineHoursPath })
                }
              />
              {s.metrics.tripCountPath && (
                <Row
                  icon="anchor"
                  title={t('settings.trips')}
                  sub={
                    s.metrics.tripCount !== undefined
                      ? formatNumber(s.metrics.tripCount, 0)
                      : t('settings.engineHoursNone', { path: s.metrics.tripCountPath })
                  }
                />
              )}
            </List>
          </Section>
        )}

        <Section title={t('settings.pluginConfig')}>
          <p class="body-m muted">{t('settings.pluginConfigBody')}</p>
          <div>
            <a class="btn btn-tonal" href={pluginConfigUrl()} target="_blank" rel="noopener">
              <Icon name="open" />
              {t('settings.openPluginConfig')}
            </a>
          </div>
        </Section>

        {s?.version && <p class="fine">{t('settings.version', { version: s.version })}</p>}
      </div>
    </div>
  )
}
