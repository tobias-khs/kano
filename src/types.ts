export type ItemType = 'computer' | 'exercise' | 'admin' | 'study' | 'other'

export type Tab = 'all' | 'daily' | 'oneoffs' | 'later' | 'history' | 'settings'

export interface Item {
  id: string
  name: string
  createdAt: number
  frequency: number // 0 = one-off, else every N days: 1 | 2 | 3 | 4 | 7 | 14 | 30
  importance: 'must' | 'optional'
  status: 'open' | 'done' | 'later' // later = parked, shown only in the Later tab
  type: ItemType
  dueDay: string | null // YYYY-MM-DD logical day; null = due now
  lastDoneAt: number | null
}

/** Item shape of the first version, still found in old stores and exports. */
export type LegacyItem = Omit<Item, 'frequency' | 'dueDay'> & {
  periodicity: { kind: 'none' | 'date' | 'daily' | 'weekly' | 'monthly' }
  dueAt: number | null
}

export interface HistoryEntry {
  id: string
  itemId: string
  name: string
  type: ItemType
  doneAt: number
  skipped?: boolean // moved on without being done
}
