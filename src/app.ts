import type { HistoryEntry, Item, ItemType, Tab } from './types.ts'
import * as db from './db.ts'
import { addDays, isOneOff, migrate, tabItems, today } from './schedule.ts'

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T

const list = $<HTMLUListElement>('#list')
const empty = $('#empty')
const settings = $('#settings')
const nav = $('nav')
const completeDialog = $<HTMLDialogElement>('#complete-dialog')
const deleteDialog = $<HTMLDialogElement>('#delete-dialog')
const laterDialog = $<HTMLDialogElement>('#later-dialog')
const createDialog = $<HTMLDialogElement>('#create-dialog')
const overwriteDialog = $<HTMLDialogElement>('#overwrite-dialog')
const createForm = $<HTMLFormElement>('#create-form')
const postpone = $('#postpone')
const skipButton = $('#skip')
const postponeDate = $<HTMLInputElement>('#postpone-date')
const resetTimeInput = $<HTMLInputElement>('#reset-time')
const importFile = $<HTMLInputElement>('#import-file')
const settingsMessage = $('#settings-message')

const RESET_TIME_KEY = 'kano.resetTime'

interface ExportFile {
  version: number
  exportedAt: string
  settings: { resetTime: string }
  items: Item[]
  history: HistoryEntry[]
}

let items: Item[] = []
let history: HistoryEntry[] = []
let resetTime = localStorage.getItem(RESET_TIME_KEY) ?? '04:00'
let tab: Tab = 'all'
let current: Item | undefined
let editing: Item | undefined
let pendingImport: ExportFile | undefined

/** The current logical day, which starts at the reset time. */
const day = () => today(Date.now(), resetTime)

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
  settings.hidden = tab !== 'settings'
  list.hidden = tab === 'settings'
  if (tab === 'settings') {
    empty.hidden = true
    return
  }
  const rows =
    tab === 'history'
      ? [...history]
          .sort((a, b) => b.doneAt - a.doneAt)
          .map((h) =>
            row(
              h.name,
              h.type,
              undefined,
              (h.skipped ? 'skipped · ' : '') +
                new Date(h.doneAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
            ),
          )
      : tabItems(items, tab, day()).map((item) => row(item.name, item.type, item.id))
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
  else item.dueDay = addDays(day(), item.frequency)
  history.push(entry)
  await db.putItem(item, entry)
  await removeRow(item.id)
}

/** Moves a recurring item to its next occurrence without it counting as done. */
async function skip(item: Item): Promise<void> {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    itemId: item.id,
    name: item.name,
    type: item.type,
    doneAt: Date.now(),
    skipped: true,
  }
  item.dueDay = addDays(day(), item.frequency)
  history.push(entry)
  await db.putItem(item, entry)
  await removeRow(item.id)
}

async function postponeItem(item: Item, date: string): Promise<void> {
  item.dueDay = date || addDays(day(), 1)
  await db.putItem(item)
  await removeRow(item.id)
}

/** Parks an item: it leaves the todo lists and shows only in the Later tab. */
async function moveToLater(item: Item): Promise<void> {
  item.status = 'later'
  await db.putItem(item)
  await removeRow(item.id)
}

/** Brings a Later item back. A recurring item is due today; a one-off keeps its due date. */
async function activate(item: Item): Promise<void> {
  item.status = 'open'
  if (!isOneOff(item)) item.dueDay = day()
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
  const frequency = Number(form.get('frequency'))
  const item: Item = {
    id: crypto.randomUUID(),
    name: (form.get('name') as string).trim(),
    createdAt: Date.now(),
    frequency,
    importance: form.get('importance') as Item['importance'],
    status: form.get('status') as 'open' | 'later',
    type: form.get('type') as ItemType,
    dueDay: frequency ? day() : (form.get('date') as string | null) || null,
    lastDoneAt: null,
  }
  items.push(item)
  await db.putItem(item)
  render()
}

async function save(item: Item, form: FormData): Promise<void> {
  const frequency = Number(form.get('frequency'))
  const status = form.get('status') as 'open' | 'later'
  const activated = item.status === 'later' && status === 'open'
  // A recurring item keeps its due day, unless it was a one-off or is brought back from Later;
  // a new frequency applies from the next completion or skip.
  if (!frequency) item.dueDay = (form.get('date') as string | null) || null
  else if (isOneOff(item) || activated) item.dueDay = day()
  item.frequency = frequency
  item.status = status
  item.name = (form.get('name') as string).trim()
  item.importance = form.get('importance') as Item['importance']
  item.type = form.get('type') as ItemType
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
for (const dialog of [completeDialog, deleteDialog, laterDialog, createDialog, overwriteDialog]) {
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
  edit: openForm,
  tomorrow: (item) => postponeItem(item, ''),
  skip,
  later: moveToLater,
  delete: remove,
  postpone: (item) => postponeItem(item, postponeDate.value),
})
onAction(laterDialog, { activate, edit: openForm, delete: remove })

// ---- list gestures: tap = complete, long-tap = edit / postpone / skip / later / delete ----
// In the Later tab both gestures open the Later dialog.

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
    if (tab === 'later') {
      openItemDialog(laterDialog, item)
      return
    }
    postpone.hidden = !(isOneOff(item) && item.importance === 'optional')
    skipButton.hidden = isOneOff(item) || item.importance === 'must'
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
  if (item) openItemDialog(tab === 'later' ? laterDialog : completeDialog, item)
})

// ---- bottom bar ----

nav.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')
  if (!button) return
  tab = button.dataset.tab as Tab
  for (const b of nav.querySelectorAll('[data-tab]')) b.classList.toggle('active', b === button)
  showMessage('')
  render()
})

// ---- create form ----

const frequencySelect = createForm.elements.namedItem('frequency') as HTMLSelectElement

function updateFields(): void {
  for (const label of createForm.querySelectorAll<HTMLElement>('[data-for]')) {
    const shown = label.dataset.for === frequencySelect.value
    label.hidden = !shown
    // Disabled controls are not submitted.
    label.querySelector('input')!.disabled = !shown
  }
}

/** Opens the form for a new item, or for editing the given one. */
function openForm(item?: Item): void {
  editing = item
  createForm.reset()
  if (item) {
    const field = (name: string) => createForm.elements.namedItem(name) as HTMLInputElement
    field('name').value = item.name
    field('type').value = item.type
    field('importance').value = item.importance
    field('frequency').value = String(item.frequency)
    field('status').value = item.status
    field('date').value = isOneOff(item) ? (item.dueDay ?? '') : ''
  }
  $('#create-title').textContent = item ? 'Edit item' : 'New item'
  $('#create-submit').textContent = item ? 'Save' : 'Create'
  updateFields()
  createDialog.showModal()
}

frequencySelect.addEventListener('change', updateFields)
$('#new').addEventListener('click', () => openForm())
$('#create-cancel').addEventListener('click', () => createDialog.close())
createForm.addEventListener('submit', () => {
  const form = new FormData(createForm)
  if (editing) save(editing, form)
  else create(form)
})

// ---- settings ----

function showMessage(text: string): void {
  settingsMessage.textContent = text
  settingsMessage.hidden = !text
}

function setResetTime(value: string): void {
  resetTime = value
  localStorage.setItem(RESET_TIME_KEY, value)
  resetTimeInput.value = value
}

resetTimeInput.value = resetTime
resetTimeInput.addEventListener('change', () => {
  // An emptied field keeps the previous time.
  setResetTime(resetTimeInput.value || resetTime)
})

$('#export').addEventListener('click', () => {
  const data: ExportFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { resetTime },
    items,
    history,
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `kano-export-${today(Date.now(), '00:00')}.json`
  link.click()
  URL.revokeObjectURL(url)
})

const hasId = (value: unknown) =>
  typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'

function parseImport(text: string): ExportFile | undefined {
  try {
    const data = JSON.parse(text)
    if (Array.isArray(data.items) && Array.isArray(data.history) && [...data.items, ...data.history].every(hasId)) {
      return data
    }
  } catch {
    // not JSON
  }
  return undefined
}

async function applyImport(data: ExportFile): Promise<void> {
  const imported = data.items.map(migrate)
  try {
    await db.replaceAll(imported, data.history)
  } catch {
    showMessage('Import failed. Your existing data was not changed.')
    return
  }
  items = imported
  history = data.history
  const time = data.settings?.resetTime
  if (typeof time === 'string' && /^\d\d:\d\d$/.test(time)) setResetTime(time)
  showMessage(`Imported ${items.length} items and ${history.length} history entries.`)
}

$('#import').addEventListener('click', () => importFile.click())
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0]
  importFile.value = ''
  if (!file) return
  const data = parseImport(await file.text())
  if (!data) {
    showMessage('This file is not a Kano export. Nothing was imported.')
    return
  }
  if (items.length || history.length) {
    pendingImport = data
    overwriteDialog.showModal()
  } else {
    await applyImport(data)
  }
})
overwriteDialog.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action
  if (!action) return
  overwriteDialog.close()
  if (action === 'overwrite' && pendingImport) applyImport(pendingImport)
  pendingImport = undefined
})

// ---- start ----

const stored = await db.getItems()
items = stored.map(migrate)
// Save items converted from the first version's format.
for (const [i, item] of items.entries()) {
  if (item !== stored[i]) await db.putItem(item)
}
history = await db.getHistory()
render()

// Items become visible when their day starts.
setInterval(render, 60_000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render()
})

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js')
