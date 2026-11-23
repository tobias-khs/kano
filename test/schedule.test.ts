import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Item, LegacyItem } from '../src/types.ts'
import { addDays, isVisible, migrate, tabItems, today } from '../src/schedule.ts'

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()

const day = '2026-11-18'

let seq = 0
function item(name: string, frequency: number, extra: Partial<Item> = {}): Item {
  return {
    id: name,
    name,
    createdAt: ++seq,
    frequency,
    importance: 'optional',
    status: 'open',
    type: 'other',
    dueDay: frequency ? day : null,
    lastDoneAt: null,
    ...extra,
  }
}

test('today starts at the reset time', () => {
  assert.equal(today(at(2026, 11, 18, 3, 59), '04:00'), '2026-11-17')
  assert.equal(today(at(2026, 11, 18, 4, 0), '04:00'), '2026-11-18')
  assert.equal(today(at(2026, 11, 18, 23, 59), '04:00'), '2026-11-18')
  assert.equal(today(at(2026, 11, 18, 0, 0), '00:00'), '2026-11-18')
  assert.equal(today(at(2026, 11, 18, 6, 29), '06:30'), '2026-11-17')
  assert.equal(today(at(2026, 11, 18, 6, 30), '06:30'), '2026-11-18')
  assert.equal(today(at(2027, 1, 1, 2, 0), '04:00'), '2026-12-31')
})

test('addDays', () => {
  assert.equal(addDays('2026-11-18', 1), '2026-11-19')
  assert.equal(addDays('2026-11-18', 14), '2026-12-02')
  assert.equal(addDays('2026-12-18', 30), '2027-01-17')
  assert.equal(addDays('2028-02-28', 2), '2028-03-01')
})

test('isVisible', () => {
  assert.equal(isVisible(item('a', 0), day), true)
  assert.equal(isVisible(item('b', 0, { status: 'done' }), day), false)
  assert.equal(isVisible(item('c', 0, { dueDay: '2026-11-19' }), day), false)
  assert.equal(isVisible(item('d', 0, { dueDay: '2026-11-18' }), day), true)
  assert.equal(isVisible(item('e', 3, { dueDay: '2026-11-17' }), day), true)
  assert.equal(isVisible(item('f', 3, { dueDay: '2026-11-21' }), day), false)
})

test('migrate converts items of the first version', () => {
  const legacy = (kind: LegacyItem['periodicity']['kind'], dueAt: number | null): LegacyItem => ({
    id: kind,
    name: kind,
    createdAt: 1,
    periodicity: { kind },
    importance: 'must',
    status: 'open',
    type: 'admin',
    dueAt,
    lastDoneAt: null,
  })
  const converted = (kind: LegacyItem['periodicity']['kind'], dueAt: number | null) => {
    const { frequency, dueDay } = migrate(legacy(kind, dueAt))
    return { frequency, dueDay }
  }

  assert.deepEqual(converted('none', null), { frequency: 0, dueDay: null })
  assert.deepEqual(converted('date', at(2026, 12, 1)), { frequency: 0, dueDay: '2026-12-01' })
  assert.deepEqual(converted('daily', at(2026, 11, 18)), { frequency: 1, dueDay: '2026-11-18' })
  assert.deepEqual(converted('weekly', at(2026, 11, 24, 9)), { frequency: 7, dueDay: '2026-11-24' })
  assert.deepEqual(converted('monthly', at(2026, 12, 17, 18, 30)), { frequency: 30, dueDay: '2026-12-17' })

  const migrated = migrate(legacy('weekly', at(2026, 11, 24, 9)))
  assert.equal('periodicity' in migrated, false)
  assert.equal('dueAt' in migrated, false)
  assert.equal(migrated.name, 'weekly')

  const currentItem = item('current', 2)
  assert.equal(migrate(currentItem), currentItem)
})

test('tab order', () => {
  const items = [
    item('every-7-optional', 7, { dueDay: '2026-11-16' }),
    item('daily-done-recently', 1, { importance: 'must', lastDoneAt: at(2026, 11, 17) }),
    item('oneoff-optional', 0),
    item('daily-done-long-ago', 1, { lastDoneAt: at(2026, 11, 10) }),
    item('oneoff-must', 0, { importance: 'must', dueDay: '2026-11-18' }),
    item('every-3-must', 3, { importance: 'must', dueDay: '2026-11-17' }),
    item('daily-never-done', 1),
    item('hidden-future', 0, { dueDay: '2026-12-24' }),
    item('hidden-not-due', 14, { dueDay: '2026-11-25' }),
    item('hidden-done', 0, { status: 'done' }),
    item('later-daily', 1, { status: 'later' }),
    item('later-oneoff', 0, { status: 'later', importance: 'must' }),
    item('later-future', 7, { status: 'later', dueDay: '2026-12-24' }),
  ]
  const names = (tab: 'all' | 'recurring' | 'oneoffs' | 'later') => tabItems(items, tab, day).map((i) => i.name)

  assert.deepEqual(names('all'), [
    'oneoff-must',
    'oneoff-optional',
    'every-3-must',
    'daily-done-recently',
    'every-7-optional',
    'daily-done-long-ago',
    'daily-never-done',
  ])
  assert.deepEqual(names('recurring'), [
    'every-7-optional',
    'every-3-must',
    'daily-never-done',
    'daily-done-long-ago',
    'daily-done-recently',
  ])
  assert.deepEqual(names('oneoffs'), ['oneoff-must', 'oneoff-optional'])
  assert.deepEqual(names('later'), ['later-daily', 'later-oneoff', 'later-future'])
})
