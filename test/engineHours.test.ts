import { describe, expect, it } from 'vitest'
import { engineHoursFromRunTime } from '../src/metrics/engineHours'

describe('engineHoursFromRunTime', () => {
  it('converts Signal K runTime seconds to hours', () => {
    expect(engineHoursFromRunTime(3600)).toBe(1)
    expect(engineHoursFromRunTime(180_000)).toBe(50)
  })

  it('returns undefined when runTime is unavailable', () => {
    expect(engineHoursFromRunTime(undefined)).toBeUndefined()
  })
})
