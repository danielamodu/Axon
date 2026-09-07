import { describe, it, expect } from 'vitest'
import { nextOfficeHoursSlot, isWithinOfficeHours } from '../office-hours'

describe('office-hours', () => {
  it('returns same time if already in window', () => {
    // Monday 15:00 UTC = valid
    const monday15 = new Date('2026-09-07T15:00:00Z')
    const result = nextOfficeHoursSlot(monday15)
    expect(result.getTime()).toBe(monday15.getTime())
  })

  it('advances to next window if outside hours', () => {
    // Monday 22:00 UTC = after office hours
    const monday22 = new Date('2026-09-07T22:00:00Z')
    const result = nextOfficeHoursSlot(monday22)
    // Should advance to Tuesday 14:00 UTC
    expect(result.getUTCDay()).toBe(2) // Tuesday
    expect(result.getUTCHours()).toBe(14)
  })

  it('skips weekend', () => {
    // Saturday 15:00 UTC
    const saturday = new Date('2026-09-12T15:00:00Z')
    const result = nextOfficeHoursSlot(saturday)
    // Should advance to Monday 14:00 UTC
    expect(result.getUTCDay()).toBe(1) // Monday
    expect(result.getUTCHours()).toBe(14)
  })

  it('correctly identifies within office hours', () => {
    const monday15 = new Date('2026-09-07T15:00:00Z')
    expect(isWithinOfficeHours(monday15)).toBe(true)

    const monday22 = new Date('2026-09-07T22:00:00Z')
    expect(isWithinOfficeHours(monday22)).toBe(false)

    const saturday = new Date('2026-09-12T15:00:00Z')
    expect(isWithinOfficeHours(saturday)).toBe(false)
  })
})
