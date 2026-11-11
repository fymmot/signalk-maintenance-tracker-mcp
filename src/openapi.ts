import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parse } from 'yaml'

/**
 * Loads and parses `schema/openapi.yaml` once. The same document is served via
 * the plugin's OpenAPI endpoint and reused as the JSON-Schema source for record
 * validation (the signalk-logbook pattern). The path resolves identically from
 * both compiled `dist/` and source `src/` (vitest) because both sit one level
 * below the repo root.
 */
let cached: OpenApiDocument | undefined

export interface OpenApiDocument {
  components: {
    schemas: Record<string, object>
  }
  [key: string]: unknown
}

export function loadOpenApi(): OpenApiDocument {
  if (cached) return cached
  const schemaPath = resolve(__dirname, '..', 'schema', 'openapi.yaml')
  cached = parse(readFileSync(schemaPath, 'utf-8')) as OpenApiDocument
  return cached
}
