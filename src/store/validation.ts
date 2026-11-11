import { Validator } from 'jsonschema'
import { loadOpenApi } from '../openapi'

/**
 * Validates records against the self-contained schemas in
 * `schema/openapi.yaml` `components.schemas`. The record schemas (MaintenanceNode,
 * ServiceLog, Issue, ChecklistTemplate, ChecklistRun) are intentionally written
 * without cross-`$ref`s so they validate standalone.
 */
export class SchemaValidator {
  private readonly validator = new Validator()

  constructor() {
    const { components } = loadOpenApi()
    for (const [name, schema] of Object.entries(components.schemas)) {
      this.validator.addSchema(schema, `/${name}`)
    }
  }

  /** Throws an Error if `data` does not conform to the named component schema. */
  validate(schemaName: string, data: unknown): void {
    const { components } = loadOpenApi()
    const schema = components.schemas[schemaName]
    if (!schema) {
      throw new Error(`Unknown schema: ${schemaName}`)
    }
    const result = this.validator.validate(data, schema)
    if (result.errors.length > 0) {
      const message = result.errors.map((e) => `${e.property} ${e.message}`).join('; ')
      throw new ValidationError(`Invalid ${schemaName}: ${message}`)
    }
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}
