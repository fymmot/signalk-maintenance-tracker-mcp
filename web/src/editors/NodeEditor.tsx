import { useState } from 'preact/hooks'
import type { NodeType } from '../../../src/types'
import { createNode, deleteNode, updateNode } from '../api/maintenance'
import { Icon } from '../components/Icon'
import { ConfirmDialog, SelectField, Sheet, TextField } from '../components/ui'
import { t, tn, type MessageKey } from '../i18n'
import { descendantsAndSelf, nodePath } from '../lib/maint'
import { navigate } from '../lib/router'
import { mutate, nodes, nodesById } from '../state/store'
import { SaveError, useSubmit } from './common'

/* A system, component or part: create, edit, move under another, delete. */
export function NodeEditor({ id, parentId, onClose }: { id?: string; parentId?: string; onClose: () => void }) {
  const existing = id ? nodesById.value.get(id) : undefined
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<NodeType>(existing?.type ?? (parentId ? 'component' : 'system'))
  const [parent, setParent] = useState(existing?.parentId ?? parentId ?? '')
  const [manufacturer, setManufacturer] = useState(existing?.manufacturer ?? '')
  const [model, setModel] = useState(existing?.model ?? '')
  const [serial, setSerial] = useState(existing?.serial ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [tried, setTried] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { busy, error, run } = useSubmit()

  const byId = nodesById.value
  // Not itself, nor anything under it: a node can't be its own ancestor.
  const blocked = existing ? descendantsAndSelf(nodes.value, existing.id) : new Set<string>()
  const parentOptions = [
    { value: '', label: t('nodeEditor.parentNone') },
    ...nodes.value
      .filter((n) => !blocked.has(n.id) && n.type !== 'part')
      .map((n) => ({ value: n.id, label: [nodePath(byId, n), n.name].filter(Boolean).join(' › ') }))
      .sort((a, b) => a.label.localeCompare(b.label))
  ]
  const under = existing ? blocked.size - 1 : 0

  const save = () => {
    setTried(true)
    if (!name.trim()) return
    const fields = {
      name: name.trim(),
      type,
      parentId: parent || undefined,
      manufacturer: manufacturer.trim() || undefined,
      model: model.trim() || undefined,
      serial: serial.trim() || undefined,
      notes: notes.trim() || undefined
    }
    void run(async () => {
      if (existing) {
        await mutate(() => updateNode(existing.id, { ...existing, ...fields }))
        onClose()
      } else {
        const created = await mutate(() => createNode(fields))
        onClose()
        navigate({ name: 'node', id: created.id })
      }
    })
  }

  return (
    <Sheet
      title={existing ? t('nodeEditor.editTitle', { name: existing.name }) : t(`nodeType.new.${type}` as MessageKey)}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          {existing && (
            <button type="button" class="btn btn-text btn-danger" onClick={() => setDeleting(true)} style={{ marginRight: 'auto' }}>
              <Icon name="delete" />
              {t('nodeEditor.delete')}
            </button>
          )}
          <button type="button" class="btn btn-text" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" class="btn btn-filled" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <TextField
        label={t('nodeEditor.name')}
        value={name}
        onInput={setName}
        required
        autoFocus={!existing}
        error={tried && !name.trim() ? t('nodeEditor.nameRequired') : undefined}
      />
      <div class="field-row">
        <SelectField<NodeType>
          label={t('nodeEditor.type')}
          value={type}
          onChange={setType}
          options={(['system', 'component', 'part'] as const).map((v) => ({ value: v, label: t(`nodeType.${v}`) }))}
        />
      </div>
      <SelectField label={t('nodeEditor.parent')} value={parent} onChange={setParent} options={parentOptions} />
      <div class="field-row">
        <TextField label={t('nodeEditor.manufacturer')} value={manufacturer} onInput={setManufacturer} />
        <TextField label={t('nodeEditor.model')} value={model} onInput={setModel} />
      </div>
      <TextField label={t('nodeEditor.serial')} value={serial} onInput={setSerial} />
      <TextField label={t('nodeEditor.notes')} value={notes} onInput={setNotes} multiline />
      <SaveError error={error} />

      {deleting && existing && (
        <ConfirmDialog
          title={t('nodeEditor.deleteTitle', { name: existing.name })}
          body={[t('nodeEditor.deleteBody'), under ? tn('nodeEditor.deleteTree', under) : ''].filter(Boolean).join(' ')}
          confirm={t('common.delete')}
          danger
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await run(async () => {
              await mutate(() => deleteNode(existing.id, under > 0))
              onClose()
              navigate(existing.parentId ? { name: 'node', id: existing.parentId } : { name: 'boat' }, { replace: true })
            })
          }}
        />
      )}
    </Sheet>
  )
}
