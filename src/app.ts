import type { HistoryEntry, Item, ItemType, Periodicity, Tab } from './types.ts'
import * as db from './db.ts'
import { firstDue, isOneOff, nextDue, startOfDate, tabItems, tomorrow } from './schedule.ts'

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T

const list = $<HTMLUListElement>('#list')
const empty = $('#empty')
const nav = $('nav')
const completeDialog = $<HTMLDialogElement>('#complete-dialog')
const deleteDialog = $<HTMLDialogElement>('#delete-dialog')
const createDialog = $<HTMLDialogElement>('#create-dialog')
const createForm = $<HTMLFormElement>('#create-form')
const postpone = $('#postpone')
const postponeDate = $<HTMLInputElement>('#postpone-date')

let items: Item[] = []
let history: HistoryEntry[] = []
let tab: Tab = 'all'
let current: Item | undefined

// ---- rendering ----

function row(name: string, type: ItemType, id?: string, note?: string): HTMLLIElement {
  const li = document.createElement('li')
  if (id) li.dataset.id = id
  const nameEl = document.createElement('span')
  nameEl.className = 'name'
  nameEl.textContent = name
  li.append(nameEl)
  if (note) {
    const noteEl = document.createElement('span')
    noteEl.className = 'note'
    noteEl.textContent = note
    li.append(noteEl)
  }
  const tag = document.createElement('span')
  tag.className = `tag tag-${type}`
  tag.textContent = type
  li.append(tag)
  return li
}

function render(): void {
  const rows =
    tab === 'history'
      ? [...history]
          .sort((a, b) => b.doneAt - a.doneAt)
          .map((h) =>
            row(
              h.name,
              h.type,
              undefined,
              new Date(h.doneAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
            ),
          )
      : tabItems(items, tab, Date.now()).map((item) => row(item.name, item.type, item.id))
  list.replaceChildren(...rows)
  empty.hidden = rows.length > 0
}

async function removeRow(id: string): Promise<void> {
  const li = list.querySelector<HTMLLIElement>(`li[data-id="${id}"]`)
  if (li) {
    const style = getComputedStyle(li)
    await li.animate(
      [
        {
          height: `${li.offsetHeight}px`,
          opacity: 1,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          marginBottom: style.marginBottom,
        },
        { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', marginBottom: '0px' },
      ],
      { duration: 250, easing: 'ease-in' },
    ).finished
  }
  render()
}

// ---- actions ----

async function complete(item: Item): Promise<void> {
  const now = Date.now()
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    itemId: item.id,
    name: item.name,
    type: item.type,
    doneAt: now,
  }
  item.lastDoneAt = now
  if (isOneOff(item)) item.status = 'done'
  else item.dueAt = nextDue(item.periodicity, now)
  history.push(entry)
  await db.putItem(item, entry)
  await removeRow(item.id)
}

async function postponeItem(item: Item, date: string): Promise<void> {
  item.dueAt = date ? startOfDate(date) : tomorrow(Date.now())
  await db.putItem(item)
  await removeRow(item.id)
}

async function remove(item: Item): Promise<void> {
  items = items.filter((i) => i.id !== item.id)
  history = history.filter((h) => h.itemId !== item.id)
  await db.deleteItem(item.id)
  await removeRow(item.id)
}

async function create(form: FormData): Promise<void> {
  const kind = form.get('kind') as Periodicity['kind']
  const time = (form.get('time') as string | null) || undefined
  let periodicity: Periodicity
  switch (kind) {
    case 'date':
      periodicity = { kind, date: form.get('date') as string }
      break
    case 'weekly':
      periodicity = { kind, weekday: Number(form.get('weekday')), time }
      break
    case 'monthly':
      periodicity = { kind, day: Number(form.get('day')), time }
      break
    default:
      periodicity = { kind }
  }
  const now = Date.now()
  const item: Item = {
    id: crypto.randomUUID(),
    name: (form.get('name') as string).trim(),
    createdAt: now,
    periodicity,
    importance: form.get('importance') as Item['importance'],
    status: 'open',
    type: form.get('type') as ItemType,
    dueAt: firstDue(periodicity, now),
    lastDoneAt: null,
  }
  items.push(item)
  await db.putItem(item)
  render()
}

// ---- dialogs ----

function openItemDialog(dialog: HTMLDialogElement, item: Item): void {
  current = item
  dialog.querySelector('.title')!.textContent = item.name
  dialog.showModal()
}

// Close on a tap that both starts and ends on the backdrop. A long-press that
// opened the dialog starts on a list row, so releasing it does not close it.
for (const dialog of [completeDialog, deleteDialog, createDialog]) {
  let downOnBackdrop = false
  dialog.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === dialog
  })
  dialog.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === dialog) dialog.close()
  })
}

function onAction(dialog: HTMLDialogElement, actions: Record<string, (item: Item) => void>): void {
  dialog.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
    if (!action) return
    dialog.close()
    if (current) actions[action]?.(current)
  })
}

onAction(completeDialog, { complete })
onAction(deleteDialog, {
  delete: remove,
  postpone: (item) => postponeItem(item, postponeDate.value),
})

// ---- list gestures: tap = complete, long-tap = delete / postpone ----

let pressTimer: number | undefined
let longPressed = false
let pressX = 0
let pressY = 0

function itemOf(target: EventTarget | null): Item | undefined {
  const id = (target as HTMLElement).closest<HTMLElement>('li[data-id]')?.dataset.id
  return items.find((item) => item.id === id)
}

list.addEventListener('pointerdown', (e) => {
  longPressed = false
  const item = itemOf(e.target)
  if (!item) return
  pressX = e.clientX
  pressY = e.clientY
  pressTimer = setTimeout(() => {
    longPressed = true
    postpone.hidden = !(isOneOff(item) && item.importance === 'optional')
    postponeDate.value = ''
    openItemDialog(deleteDialog, item)
  }, 500)
})
list.addEventListener('pointermove', (e) => {
  if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 10) clearTimeout(pressTimer)
})
for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
  list.addEventListener(type, () => clearTimeout(pressTimer))
}
list.addEventListener('contextmenu', (e) => e.preventDefault())
list.addEventListener('click', (e) => {
  if (longPressed) return
  const item = itemOf(e.target)
  if (item) openItemDialog(completeDialog, item)
})

// ---- bottom bar ----

nav.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')
  if (!button) return
  tab = button.dataset.tab as Tab
  for (const b of nav.querySelectorAll('[data-tab]')) b.classList.toggle('active', b === button)
  render()
})

// ---- create form ----

const kindSelect = createForm.elements.namedItem('kind') as HTMLSelectElement
const timeInput = createForm.elements.namedItem('time') as HTMLInputElement

function updateFields(): void {
  for (const label of createForm.querySelectorAll<HTMLElement>('[data-for]')) {
    const shown = label.dataset.for!.split(' ').includes(kindSelect.value)
    label.hidden = !shown
    // Disabled controls are neither validated nor submitted.
    label.querySelector<HTMLInputElement | HTMLSelectElement>('input, select')!.disabled = !shown
  }
}

kindSelect.addEventListener('change', () => {
  timeInput.value = kindSelect.value === 'weekly' ? '09:00' : ''
  updateFields()
})
$('#new').addEventListener('click', () => {
  createForm.reset()
  updateFields()
  createDialog.showModal()
})
$('#create-cancel').addEventListener('click', () => createDialog.close())
createForm.addEventListener('submit', () => create(new FormData(createForm)))

// ---- start ----

;[items, history] = await Promise.all([db.getItems(), db.getHistory()])
render()

// Items become visible when they fall due.
setInterval(render, 60_000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render()
})

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')
