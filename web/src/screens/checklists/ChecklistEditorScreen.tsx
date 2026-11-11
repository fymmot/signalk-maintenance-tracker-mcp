import { useState } from 'preact/hooks'
import type { ChecklistItemTemplate, ChecklistSchedule, SeasonMilestone } from '../../../../src/types'
import { createTemplate, deleteTemplate, updateTemplate } from '../../api/maintenance'
import { Icon } from '../../components/Icon'
import { AppBar, ConfirmDialog, Dialog, OverflowMenu, SelectField, TextField, focusFirstInvalid } from '../../components/ui'
import { t } from '../../i18n'
import { checklistSections } from '../../lib/checklists'
import { isExpanded } from '../../lib/media'
import { navigate } from '../../lib/router'
import { canWrite, mutate, templates } from '../../state/store'
import { SaveError, useSubmit } from '../../editors/common'
import { Missing } from '../states'
import { checklistsCrumb, templateTrail } from '../../lib/trail'

/*
 * Make or change a checklist: sections, their steps, and when each shows in Work.
 * Items keep their id and node, so a run's answers and "open an issue" still line up.
 */

interface EditStep {
  key: string
  id?: string
  text: string
  nodeId?: string
}
interface EditSection {
  key: string
  name?: string
  show: SeasonMilestone | ''
  steps: EditStep[]
}

let keySeq = 0
const key = () => `k${++keySeq}`

export function ChecklistEditorScreen({ id }: { id?: string }) {
  const existing = id ? templates.value.find((x) => x.id === id) : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [sections, setSections] = useState<EditSection[]>(() => {
    if (!existing) return [{ key: key(), show: '', steps: [{ key: key(), text: '' }] }]
    return checklistSections(existing).map((s) => ({
      key: key(),
      name: s.name,
      show: existing.schedule?.find((x) => x.section === s.name)?.milestone ?? '',
      steps: s.items.map((i) => ({ key: key(), id: i.id, text: i.text, nodeId: i.nodeId }))
    }))
  })
  const [renaming, setRenaming] = useState<{ index: number; value: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [tried, setTried] = useState(false)
  const { busy, error, run } = useSubmit()

  if (id && !existing) {
    return (
      <div>
        <AppBar title={t('cl.editTitle')} trail={[checklistsCrumb()]} back={!isExpanded.value} />
        <div class="pane-inner">
          <Missing />
        </div>
      </div>
    )
  }

  const setSection = (i: number, patch: Partial<EditSection>) => setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const setStep = (si: number, i: number, text: string) =>
    setSection(si, { steps: sections[si].steps.map((st, j) => (j === i ? { ...st, text } : st)) })
  const moveStep = (si: number, i: number, by: number) => {
    const steps = [...sections[si].steps]
    const [st] = steps.splice(i, 1)
    steps.splice(i + by, 0, st)
    setSection(si, { steps })
    requestAnimationFrame(() => document.getElementById(`step-${st.key}`)?.focus())
  }

  const save = () => {
    setTried(true)
    if (!name.trim()) return
    const items: Array<Partial<ChecklistItemTemplate>> = sections.flatMap((s) =>
      s.steps
        .filter((st) => st.text.trim())
        .map((st) => ({ id: st.id, text: st.text.trim(), category: s.name || undefined, nodeId: st.nodeId }))
    )
    const schedule: ChecklistSchedule[] = sections
      .filter((s) => s.show)
      .map((s) => ({ section: s.name || undefined, milestone: s.show as SeasonMilestone, withinDays: 14 }))
    const body = { name: name.trim(), description: description.trim() || undefined, items: items as ChecklistItemTemplate[], schedule }
    void run(async () => {
      if (existing) {
        await mutate(() => updateTemplate(existing.id, body))
        navigate({ name: 'checklist', id: existing.id }, { replace: true })
      } else {
        const created = await mutate(() => createTemplate(body))
        navigate({ name: 'checklist', id: created.id }, { replace: true })
      }
    })
  }

  const multi = sections.length > 1
  return (
    <div>
      <AppBar title={existing ? t('cl.editTitle') : t('cl.new')} trail={templateTrail(existing)} back={!isExpanded.value} />
      <form
        class="pane-inner"
        onSubmit={(e) => {
          e.preventDefault()
          save()
          focusFirstInvalid(e.currentTarget as HTMLElement)
        }}
        noValidate
      >
        <TextField label={t('cl.name')} value={name} onInput={setName} autoFocus={!existing} error={tried && !name.trim() ? t('cl.nameRequired') : undefined} />
        <TextField label={t('cl.description')} value={description} onInput={setDescription} multiline />

        {sections.map((s, si) => (
          <fieldset class="card stack fieldset" style={{ '--stack-gap': '12px' }}>
            <legend class="visually-hidden">{s.name ?? (multi ? t('cl.untitled') : t('cl.whole'))}</legend>
            <div class="row">
              <h2 class="title-l grow">{s.name ?? (multi ? t('cl.untitled') : t('cl.whole'))}</h2>
              <button type="button" class="icon-btn" aria-label={t('cl.sectionRename')} onClick={() => setRenaming({ index: si, value: s.name ?? '' })}>
                <Icon name="edit" />
              </button>
            </div>
            <SelectField<SeasonMilestone | ''>
              label={t('cl.showInWork')}
              value={s.show}
              onChange={(show) => setSection(si, { show })}
              options={[
                { value: '', label: t('cl.showNever') },
                { value: 'haulout', label: t('cl.afterHaulout') },
                { value: 'launch', label: t('cl.atLaunch') }
              ]}
            />
            <ol class="edit-steps">
              {s.steps.map((st, i) => (
                <li>
                  <span class="edit-step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <input
                    id={`step-${st.key}`}
                    class="field grow"
                    value={st.text}
                    aria-label={t('cl.stepText', { n: String(i + 1) })}
                    onInput={(e) => setStep(si, i, (e.currentTarget as HTMLInputElement).value)}
                    onKeyDown={(e) => {
                      // Alt+↑/↓ moves a step without leaving the keyboard.
                      if (e.altKey && e.key === 'ArrowUp' && i > 0) {
                        e.preventDefault()
                        moveStep(si, i, -1)
                      } else if (e.altKey && e.key === 'ArrowDown' && i < s.steps.length - 1) {
                        e.preventDefault()
                        moveStep(si, i, 1)
                      }
                    }}
                  />
                  <OverflowMenu
                    label={t('cl.stepActions', { step: st.text || t('cl.stepText', { n: String(i + 1) }) })}
                    items={[
                      { label: t('cl.moveUp'), icon: 'arrowUp', disabled: i === 0, onSelect: () => moveStep(si, i, -1) },
                      { label: t('cl.moveDown'), icon: 'arrowDown', disabled: i === s.steps.length - 1, onSelect: () => moveStep(si, i, 1) },
                      {
                        label: t('cl.removeStep'),
                        icon: 'delete',
                        danger: true,
                        onSelect: () => setSection(si, { steps: s.steps.filter((_, j) => j !== i) })
                      }
                    ]}
                  />
                </li>
              ))}
            </ol>
            <div>
              <button
                type="button"
                class="btn btn-text"
                onClick={() => {
                  const st = { key: key(), text: '' }
                  setSection(si, { steps: [...s.steps, st] })
                  requestAnimationFrame(() => document.getElementById(`step-${st.key}`)?.focus())
                }}
              >
                <Icon name="add" />
                {t('cl.addStep')}
              </button>
            </div>
          </fieldset>
        ))}

        <div>
          <button type="button" class="btn btn-tonal" onClick={() => setRenaming({ index: -1, value: '' })}>
            <Icon name="add" />
            {t('cl.addSection')}
          </button>
        </div>
        <p class="fine">{t('cl.changesApply')}</p>
        <SaveError error={error} />
        {canWrite.value && (
          <div class="button-row">
            <button type="submit" class="btn btn-filled" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
            {existing && (
              <button type="button" class="btn btn-text btn-danger" onClick={() => setDeleting(true)}>
                <Icon name="delete" />
                {t('common.delete')}
              </button>
            )}
          </div>
        )}
      </form>

      {renaming && (
        <Dialog
          title={renaming.index < 0 ? t('cl.addSection') : t('cl.sectionRename')}
          onClose={() => setRenaming(null)}
          actions={
            <>
              <button type="button" class="btn btn-text" onClick={() => setRenaming(null)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                class="btn btn-filled"
                disabled={!renaming.value.trim()}
                onClick={() => {
                  const value = renaming.value.trim()
                  if (renaming.index < 0) setSections([...sections, { key: key(), name: value, show: '', steps: [{ key: key(), text: '' }] }])
                  else setSection(renaming.index, { name: value })
                  setRenaming(null)
                }}
              >
                {t('common.done')}
              </button>
            </>
          }
        >
          <TextField label={t('cl.sectionName')} value={renaming.value} onInput={(value) => setRenaming({ ...renaming, value })} autoFocus />
        </Dialog>
      )}
      {deleting && existing && (
        <ConfirmDialog
          title={t('cl.deleteTitle')}
          body={t('cl.deleteBody')}
          confirm={t('common.delete')}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await run(async () => {
              await mutate(() => deleteTemplate(existing.id))
              navigate({ name: 'checklists' }, { replace: true })
            })
          }}
        />
      )}
    </div>
  )
}
