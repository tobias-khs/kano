import type { Item, Periodicity, Tab } from './types.ts'

function startOfDay(t: number): Date {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Local midnight of a YYYY-MM-DD date. */
export function startOfDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

export function tomorrow(now: number): number {
  const d = startOfDay(now)
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

function withTime(day: Date, time?: string): number {
  if (time) {
    const [h, m] = time.split(':').map(Number)
    day.setHours(h, m, 0, 0)
  }
  return day.getTime()
}

/** First occurrence on or after the day `from` (a local midnight). */
function occurrence(p: Periodicity, from: Date): number | null {
  switch (p.kind) {
    case 'none':
      return null
    case 'date':
      return startOfDate(p.date)
    case 'daily':
      return from.getTime()
    case 'weekly': {
      const d = new Date(from)
      d.setDate(d.getDate() + ((p.weekday - d.getDay() + 7) % 7))
      return withTime(d, p.time)
    }
    case 'monthly':
      for (let i = 0; ; i++) {
        const y = from.getFullYear()
        const m = from.getMonth() + i
        const lastDay = new Date(y, m + 1, 0).getDate()
        const d = new Date(y, m, Math.min(p.day, lastDay))
        if (d >= from) return withTime(d, p.time)
      }
  }
}

/** Due time of a new item. Today counts, even if the time has already passed. */
export function firstDue(p: Periodicity, now: number): number | null {
  return occurrence(p, startOfDay(now))
}

/** Due time of a periodic item after it was completed at `now`. */
export function nextDue(p: Periodicity, now: number): number | null {
  return occurrence(p, new Date(tomorrow(now)))
}

export function isOneOff(item: Item): boolean {
  return item.periodicity.kind === 'none' || item.periodicity.kind === 'date'
}

export function isVisible(item: Item, now: number): boolean {
  return item.status === 'open' && (item.dueAt === null || item.dueAt <= now)
}

const mustFirst = (item: Item) => (item.importance === 'must' ? 0 : 1)

/** Visible items of a list tab, in display order. */
export function tabItems(items: Item[], tab: Exclude<Tab, 'history'>, now: number): Item[] {
  const visible = items.filter((item) => isVisible(item, now))
  switch (tab) {
    case 'all':
      return visible.sort(
        (a, b) =>
          Number(!isOneOff(a)) - Number(!isOneOff(b)) ||
          mustFirst(a) - mustFirst(b) ||
          (isOneOff(a) ? a.createdAt - b.createdAt : (a.dueAt ?? 0) - (b.dueAt ?? 0)),
      )
    case 'daily':
      return visible
        .filter((item) => item.periodicity.kind === 'daily')
        .sort((a, b) => (a.lastDoneAt ?? 0) - (b.lastDoneAt ?? 0) || a.createdAt - b.createdAt)
    case 'oneoffs':
      return visible
        .filter(isOneOff)
        .sort((a, b) => mustFirst(a) - mustFirst(b) || a.createdAt - b.createdAt)
  }
}
