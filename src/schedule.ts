import type { Item, LegacyItem, Tab } from './types.ts'

function format(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The logical day `now` belongs to. A day starts at `resetTime` (HH:MM), not at midnight. */
export function today(now: number, resetTime: string): string {
  const [h, m] = resetTime.split(':').map(Number)
  const d = new Date(now)
  d.setHours(d.getHours() - h, d.getMinutes() - m)
  return format(d)
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return format(new Date(y, m - 1, d + n))
}

export function isOneOff(item: Item): boolean {
  return item.frequency === 0
}

export function isVisible(item: Item, day: string): boolean {
  return item.status === 'open' && (item.dueDay === null || item.dueDay <= day)
}

const legacyFrequency = { none: 0, date: 0, daily: 1, weekly: 7, monthly: 30 }

/** Converts an item of the first version; current items are returned as they are. */
export function migrate(stored: Item | LegacyItem): Item {
  if (!('periodicity' in stored)) return stored
  const { periodicity, dueAt, ...rest } = stored
  return {
    ...rest,
    frequency: legacyFrequency[periodicity.kind],
    dueDay: dueAt === null ? null : format(new Date(dueAt)),
  }
}

const mustFirst = (item: Item) => (item.importance === 'must' ? 0 : 1)

/** Items of a list tab on logical day `day`, in display order. */
export function tabItems(
  items: Item[],
  tab: 'all' | 'recurring' | 'oneoffs' | 'later',
  day: string,
): Item[] {
  if (tab === 'later') {
    return items.filter((item) => item.status === 'later').sort((a, b) => a.createdAt - b.createdAt)
  }
  const visible = items.filter((item) => isVisible(item, day))
  switch (tab) {
    case 'all': {
      // Every open item, due or not: one-offs, then recurring; within each, due before not due.
      const notDue = (item: Item) => Number(!isVisible(item, day))
      const byDueDay = (a: Item, b: Item) => (a.dueDay ?? '').localeCompare(b.dueDay ?? '')
      return items
        .filter((item) => item.status === 'open')
        .sort(
          (a, b) =>
            Number(!isOneOff(a)) - Number(!isOneOff(b)) ||
            notDue(a) - notDue(b) ||
            (notDue(a)
              ? byDueDay(a, b) || mustFirst(a) - mustFirst(b)
              : mustFirst(a) - mustFirst(b) ||
                (isOneOff(a) ? a.createdAt - b.createdAt : byDueDay(a, b))),
        )
    }
    case 'recurring':
      return visible
        .filter((item) => !isOneOff(item))
        .sort((a, b) => (a.lastDoneAt ?? 0) - (b.lastDoneAt ?? 0) || a.createdAt - b.createdAt)
    case 'oneoffs':
      return visible
        .filter(isOneOff)
        .sort((a, b) => mustFirst(a) - mustFirst(b) || a.createdAt - b.createdAt)
  }
}
