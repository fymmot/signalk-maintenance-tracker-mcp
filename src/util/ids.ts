import { randomUUID } from 'crypto'

/** Turns a human label into a filesystem/id-safe slug, falling back to a uuid. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug || randomUUID()
}

export function shortId(): string {
  return randomUUID().slice(0, 8)
}

/** Builds a sortable, id-safe log id like `2026-06-11T09-30-00-000Z-anode`. */
export function logId(date: Date, slug: string): string {
  const iso = date.toISOString().replace(/[:.]/g, '-')
  return `${iso}-${slug}`
}
