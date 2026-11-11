import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { Attachment, PendingPhoto } from '../../../src/types'
import { API, errorKey, mediaUrl } from '../api/client'
import { updateAttachments, type AttachmentsWrite } from '../api/maintenance'
import { t } from '../i18n'
import { filesFrom, uploadFiles } from '../lib/photos'
import { canWrite, refreshAll } from '../state/store'
import { Icon } from './Icon'
import { ConfirmDialog, TextField, snackbar } from './ui'

/*
 * Photos on a record. The strip opens a full-screen viewer (pager, zoom, caption).
 * With a `target`, photos can be added (camera, file picker, paste or drop) and
 * captioned or removed; they go through POST /attachments.
 */

type Target = Pick<AttachmentsWrite, 'kind' | 'id' | 'itemId'>

function pendingUrl(handle: string): string {
  return `${API}/photos/pending/${encodeURIComponent(handle)}`
}

/** A hidden file input and the button that opens it; phones offer the camera too. */
function AddPhotosButton({ busy, onFiles, label }: { busy: boolean; onFiles: (files: File[]) => void; label?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const el = e.currentTarget as HTMLInputElement
          onFiles([...(el.files ?? [])])
          el.value = ''
        }}
      />
      <button type="button" class="btn btn-tonal btn-s" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <span class="loader" aria-hidden="true" /> : <Icon name="camera" />}
        {label ?? t('photos.add')}
      </button>
    </>
  )
}

function Viewer({
  photos,
  start,
  target,
  onChanged,
  onClose
}: {
  photos: Attachment[]
  start: number
  target?: Target
  onChanged?: (record: unknown) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [i, setI] = useState(start)
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [failed, setFailed] = useState(false)
  const titleId = useId()
  const photo = photos[Math.min(i, photos.length - 1)]
  const write = !!target && canWrite.value

  useLayoutEffect(() => {
    const d = ref.current!
    d.showModal()
    const close = () => onClose()
    d.addEventListener('close', close)
    return () => {
      d.removeEventListener('close', close)
      if (d.open) d.close()
    }
  }, [])
  useEffect(() => {
    setZoom(null)
    setFailed(false)
  }, [i])

  if (!photo) return null
  const go = (by: number) => setI((i + by + photos.length) % photos.length)

  const saveCaption = async () => {
    if (!target || editing === null) return
    try {
      onChanged?.(await updateAttachments({ ...target, captions: { [photo.id]: editing } }))
      await refreshAll()
      setEditing(null)
    } catch (e) {
      snackbar(t(errorKey(e)))
    }
  }

  return (
    <dialog
      ref={ref}
      class="photo-viewer"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (editing !== null) return
        if (e.key === 'ArrowRight') go(1)
        else if (e.key === 'ArrowLeft') go(-1)
      }}
    >
      <div class="viewer-head">
        <button type="button" class="icon-btn" aria-label={t('nav.close')} onClick={() => ref.current?.close()}>
          <Icon name="close" />
        </button>
        <h2 id={titleId} class="title-m grow">
          {photo.caption || t('photos.nth', { n: String(i + 1), total: String(photos.length) })}
        </h2>
        <button
          type="button"
          class="icon-btn"
          aria-pressed={!!zoom}
          aria-label={t('photos.zoom')}
          onClick={() => setZoom(zoom ? null : { x: 50, y: 50 })}
        >
          <Icon name="search" />
        </button>
        {write && (
          <>
            <button type="button" class="icon-btn" aria-label={t('photos.caption')} onClick={() => setEditing(photo.caption ?? '')}>
              <Icon name="edit" />
            </button>
            <button type="button" class="icon-btn" aria-label={t('photos.remove')} onClick={() => setRemoving(true)}>
              <Icon name="delete" />
            </button>
          </>
        )}
      </div>
      <div
        class={`viewer-stage${zoom ? ' is-zoomed' : ''}`}
        onDblClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          setZoom(zoom ? null : { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 })
        }}
      >
        {failed ? (
          <p class="body-l viewer-error">{t('photos.loadFailed')}</p>
        ) : (
          <img
            src={mediaUrl(photo.id)}
            alt={photo.caption ?? t('photos.nth', { n: String(i + 1), total: String(photos.length) })}
            style={zoom ? { transform: 'scale(2.5)', transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      {editing !== null ? (
        <form
          class="viewer-foot"
          onSubmit={(e) => {
            e.preventDefault()
            void saveCaption()
          }}
        >
          <div class="grow">
            <TextField label={t('photos.caption')} value={editing} onInput={setEditing} autoFocus />
          </div>
          <button type="button" class="btn btn-text" onClick={() => setEditing(null)}>
            {t('common.cancel')}
          </button>
          <button type="submit" class="btn btn-filled">
            {t('common.save')}
          </button>
        </form>
      ) : (
        photos.length > 1 && (
          <div class="viewer-foot">
            <button type="button" class="icon-btn icon-btn-tonal" aria-label={t('photos.prev')} onClick={() => go(-1)}>
              <Icon name="back" />
            </button>
            <span class="grow body-m" style={{ textAlign: 'center' }} aria-live="polite">
              {t('photos.nth', { n: String(i + 1), total: String(photos.length) })}
            </span>
            <button type="button" class="icon-btn icon-btn-tonal" aria-label={t('photos.next')} onClick={() => go(1)}>
              <Icon name="chevron" />
            </button>
          </div>
        )
      )}
      {removing && target && (
        <ConfirmDialog
          title={t('photos.removeTitle')}
          body={t('photos.removeBody')}
          confirm={t('photos.remove')}
          danger
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            try {
              onChanged?.(await updateAttachments({ ...target, remove: [photo.id] }))
              await refreshAll()
              if (photos.length <= 1) ref.current?.close()
              else setI(Math.max(0, i - 1))
            } catch (e) {
              snackbar(t(errorKey(e)))
            }
          }}
        />
      )}
    </dialog>
  )
}

export function PhotoStrip({
  attachments,
  target,
  onChanged
}: {
  attachments?: Attachment[]
  target?: Target
  /** The record as the server returned it after a change (for screens holding their own copy). */
  onChanged?: (record: unknown) => void
}) {
  const [open, setOpen] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [dragging, setDragging] = useState(false)
  const photos = attachments ?? []
  const write = !!target && canWrite.value

  const add = async (files: File[]) => {
    if (!target || !files.length || busy) return
    setBusy(true)
    try {
      const uploaded = await uploadFiles(files, (done, total) =>
        setProgress(total > 1 && done < total ? t('photos.uploadingN', { n: String(done + 1), total: String(total) }) : t('photos.uploading'))
      )
      if (uploaded.length) {
        onChanged?.(await updateAttachments({ ...target, photos: uploaded.map((p) => ({ handle: p.handle })) }))
        await refreshAll()
        snackbar(uploaded.length === 1 ? t('photos.added') : t('photos.addedN', { n: String(uploaded.length) }))
      }
    } catch (e) {
      snackbar(t(errorKey(e)) === t('error.save') ? t('photos.uploadFailed') : t(errorKey(e)))
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  if (!photos.length && !write) return null
  return (
    <div
      class={`photo-area${dragging ? ' is-dragging' : ''}`}
      onDragOver={
        write
          ? (e) => {
              e.preventDefault()
              setDragging(true)
            }
          : undefined
      }
      onDragLeave={write ? () => setDragging(false) : undefined}
      onDrop={
        write
          ? (e) => {
              e.preventDefault()
              setDragging(false)
              void add(filesFrom(e.dataTransfer))
            }
          : undefined
      }
      onPaste={
        write
          ? (e) => {
              const files = filesFrom(e.clipboardData)
              if (files.length) {
                e.preventDefault()
                void add(files)
              }
            }
          : undefined
      }
    >
      {photos.length > 0 && (
        <ul class="photo-strip">
          {photos.map((a, i) => (
            <li>
              <button
                type="button"
                class="photo-thumb"
                aria-label={a.caption ? `${a.caption}, ${t('photos.nth', { n: String(i + 1), total: String(photos.length) })}` : t('photos.nth', { n: String(i + 1), total: String(photos.length) })}
                onClick={() => setOpen(i)}
              >
                <img src={mediaUrl(a.id)} alt="" loading="lazy" width={a.width} height={a.height} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {write && (
        <div class="row wrap">
          <AddPhotosButton busy={busy} onFiles={(f) => void add(f)} />
          <span class="fine" role="status" aria-live="polite">
            {progress || (photos.length === 0 ? t('photos.dropHint') : '')}
          </span>
        </div>
      )}
      {open !== null && <Viewer photos={photos} start={open} target={target} onChanged={onChanged} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Photos picked in an editor, uploaded straight away and linked by the editor's save. */
export function PhotoPicker({ value, onChange }: { value: PendingPhoto[]; onChange: (photos: PendingPhoto[]) => void }) {
  const [busy, setBusy] = useState(false)
  const add = async (files: File[]) => {
    if (!files.length || busy) return
    setBusy(true)
    try {
      onChange([...value, ...(await uploadFiles(files))])
    } catch {
      snackbar(t('photos.uploadFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      class="photo-area"
      onPaste={(e) => {
        const files = filesFrom(e.clipboardData)
        if (files.length) {
          e.preventDefault()
          void add(files)
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void add(filesFrom(e.dataTransfer))
      }}
    >
      <span class="field-label">{t('photos.title')}</span>
      {value.length > 0 && (
        <ul class="photo-strip">
          {value.map((p, i) => (
            <li class="photo-pending">
              <img class="photo-thumb-img" src={pendingUrl(p.handle)} alt={t('photos.nth', { n: String(i + 1), total: String(value.length) })} />
              <button
                type="button"
                class="icon-btn icon-btn-tonal photo-remove"
                aria-label={t('photos.removeNth', { n: String(i + 1) })}
                onClick={() => onChange(value.filter((x) => x.handle !== p.handle))}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <AddPhotosButton busy={busy} onFiles={(f) => void add(f)} />
      </div>
    </div>
  )
}
