import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Item, Periodicity } from '../src/types.ts'
import { firstDue, isVisible, nextDue, startOfDate, tabItems, tomorrow } from '../src/schedule.ts'

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()

// Tuesday 17 November 2026, 15:00
const now = at(2026, 11, 17, 15)

let seq = 0
function item(name: string, periodicity: Periodicity, extra: Partial<Item> = {}): Item {
  return {
    id: name,
    name,
    createdAt: ++seq,
    periodicity,
    importance: 'optional',
    status: 'open',
    type: 'admin',
    dueAt: firstDue(periodicity, now),
    lastDoneAt: null,
    ...extra,
  }
}

test('firstDue', () => {
  assert.equal(firstDue({ kind: 'none' }, now), null)
  assert.equal(firstDue({ kind: 'date', date: '2026-12-01' }, now), at(2026, 12, 1))
  assert.equal(firstDue({ kind: 'daily' }, now), at(2026, 11, 17))
  // today counts even though 09:00 has passed
  assert.equal(firstDue({ kind: 'weekly', weekday: 2, time: '09:00' }, now), at(2026, 11, 17, 9))
  assert.equal(firstDue({ kind: 'weekly', weekday: 1 }, now), at(2026, 11, 23))
  assert.equal(firstDue({ kind: 'monthly', day: 17, time: '18:30' }, now), at(2026, 11, 17, 18, 30))
  assert.equal(firstDue({ kind: 'monthly', day: 5 }, now), at(2026, 12, 5))
  assert.equal(firstDue({ kind: 'monthly', day: 31 }, now), at(2026, 11, 30))
})

test('nextDue', () => {
  assert.equal(nextDue({ kind: 'daily' }, now), at(2026, 11, 18))
  assert.equal(nextDue({ kind: 'weekly', weekday: 2, time: '09:00' }, now), at(2026, 11, 24, 9))
  assert.equal(nextDue({ kind: 'weekly', weekday: 3 }, now), at(2026, 11, 18))
  assert.equal(nextDue({ kind: 'monthly', day: 17 }, now), at(2026, 12, 17))
  assert.equal(nextDue({ kind: 'monthly', day: 31 }, at(2026, 11, 30, 8)), at(2026, 12, 31))
  assert.equal(nextDue({ kind: 'monthly', day: 31 }, at(2026, 12, 31, 8)), at(2027, 1, 31))
  assert.equal(nextDue({ kind: 'monthly', day: 31 }, at(2027, 1, 31, 8)), at(2027, 2, 28))
})

test('date helpers', () => {
  assert.equal(startOfDate('2026-11-20'), at(2026, 11, 20))
  assert.equal(tomorrow(now), at(2026, 11, 18))
})

test('isVisible', () => {
  assert.equal(isVisible(item('a', { kind: 'none' }), now), true)
  assert.equal(isVisible(item('b', { kind: 'none' }, { status: 'done' }), now), false)
  assert.equal(isVisible(item('c', { kind: 'date', date: '2026-11-18' }), now), false)
  assert.equal(isVisible(item('d', { kind: 'date', date: '2026-11-17' }), now), true)
  assert.equal(isVisible(item('e', { kind: 'weekly', weekday: 2, time: '16:00' }), now), false)
  assert.equal(isVisible(item('f', { kind: 'weekly', weekday: 2, time: '09:00' }), now), true)
})

test('tab order', () => {
  const items = [
    item('weekly-optional', { kind: 'weekly', weekday: 2 }),
    item('daily-done-recently', { kind: 'daily' }, { importance: 'must', lastDoneAt: at(2026, 11, 16) }),
    item('oneoff-optional', { kind: 'none' }),
    item('daily-done-long-ago', { kind: 'daily' }, { lastDoneAt: at(2026, 11, 10) }),
    item('oneoff-must', { kind: 'date', date: '2026-11-17' }, { importance: 'must' }),
    item('monthly-must', { kind: 'monthly', day: 17, time: '09:00' }, { importance: 'must' }),
    item('daily-never-done', { kind: 'daily' }),
    item('hidden-future', { kind: 'date', date: '2026-12-24' }),
    item('hidden-done', { kind: 'none' }, { status: 'done' }),
  ]
  const names = (tab: 'all' | 'daily' | 'oneoffs') => tabItems(items, tab, now).map((i) => i.name)

  assert.deepEqual(names('all'), [
    'oneoff-must',
    'oneoff-optional',
    'daily-done-recently',
    'monthly-must',
    'weekly-optional',
    'daily-done-long-ago',
    'daily-never-done',
  ])
  assert.deepEqual(names('daily'), ['daily-never-done', 'daily-done-long-ago', 'daily-done-recently'])
  assert.deepEqual(names('oneoffs'), ['oneoff-must', 'oneoff-optional'])
})
