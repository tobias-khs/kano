export type Periodicity =
  | { kind: 'none' }
  | { kind: 'date'; date: string } // YYYY-MM-DD
  | { kind: 'weekly'; weekday: number; time?: string } // 0 (Sunday) - 6, HH:MM
  | { kind: 'monthly'; day: number; time?: string } // 1-31, HH:MM
  | { kind: 'daily' }

export type ItemType = 'computer' | 'exercise' | 'admin' | 'study'

export type Tab = 'all' | 'daily' | 'oneoffs' | 'history'

export interface Item {
  id: string
  name: string
  createdAt: number
  periodicity: Periodicity
  importance: 'must' | 'optional'
  status: 'open' | 'done'
  type: ItemType
  dueAt: number | null // null = due now
  lastDoneAt: number | null
}

export interface HistoryEntry {
  id: string
  itemId: string
  name: string
  type: ItemType
  doneAt: number
}
