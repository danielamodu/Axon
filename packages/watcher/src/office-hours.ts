import { OFFICE_HOURS } from './constants'

/**
 * Given a timestamp, return the next valid execution slot
 * respecting the office-hours constraint:
 * Monday–Friday, 14:00–21:00 UTC
 * 
 * If the timestamp already falls inside a valid window → return it as-is
 * If it falls outside → advance to the next window opening
 */
export function nextOfficeHoursSlot(from: Date): Date {
  const dt = new Date(from)

  // Try up to 7 days ahead to find a valid window
  for (let attempt = 0; attempt < 7 * 24; attempt++) {
    const day = dt.getUTCDay()
    const hour = dt.getUTCHours()

    const isActiveDay = (OFFICE_HOURS.activeDays as readonly number[]).includes(day)
    const isActiveHour = hour >= OFFICE_HOURS.startHour && hour < OFFICE_HOURS.endHour

    if (isActiveDay && isActiveHour) {
      return dt
    }

    // Advance by 1 hour
    dt.setUTCHours(dt.getUTCHours() + 1)
    dt.setUTCMinutes(0)
    dt.setUTCSeconds(0)
    dt.setUTCMilliseconds(0)

    // If we just entered a new day, snap to start of office hours
    const newDay = dt.getUTCDay()
    const newHour = dt.getUTCHours()
    const newDayActive = (OFFICE_HOURS.activeDays as readonly number[]).includes(newDay)

    if (newDayActive && newHour < OFFICE_HOURS.startHour) {
      dt.setUTCHours(OFFICE_HOURS.startHour)
    }
  }

  throw new Error(`Could not find office hours slot within 7 days of ${from.toISOString()}`)
}

/**
 * Check if a given date falls within office hours
 */
export function isWithinOfficeHours(dt: Date): boolean {
  const day = dt.getUTCDay()
  const hour = dt.getUTCHours()
  return (
    (OFFICE_HOURS.activeDays as readonly number[]).includes(day) &&
    hour >= OFFICE_HOURS.startHour &&
    hour < OFFICE_HOURS.endHour
  )
}

/**
 * Given an execution window, return how many minutes remain
 * until the next office hours slot opens
 */
export function minutesUntilNextWindow(from: Date): number {
  const next = nextOfficeHoursSlot(from)
  return Math.floor((next.getTime() - from.getTime()) / 60_000)
}
