import type { HistoryEntry, Item } from './types.ts'

let dbPromise: Promise<IDBDatabase> | undefined

function open(): Promise<IDBDatabase> {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('kano', 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('items', { keyPath: 'id' })
      db.createObjectStore('history', { keyPath: 'id' }).createIndex('itemId', 'itemId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
}

export async function getItems(): Promise<Item[]> {
  return result((await open()).transaction('items').objectStore('items').getAll())
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return result((await open()).transaction('history').objectStore('history').getAll())
}

/** Saves an item and, when given, its new history entry in one transaction. */
export async function putItem(item: Item, entry?: HistoryEntry): Promise<void> {
  const tx = (await open()).transaction(['items', 'history'], 'readwrite')
  tx.objectStore('items').put(item)
  if (entry) tx.objectStore('history').put(entry)
  await done(tx)
}

/** Deletes everything and stores the given data instead, in one transaction. */
export async function replaceAll(items: Item[], history: HistoryEntry[]): Promise<void> {
  const tx = (await open()).transaction(['items', 'history'], 'readwrite')
  try {
    const itemStore = tx.objectStore('items')
    const historyStore = tx.objectStore('history')
    itemStore.clear()
    historyStore.clear()
    for (const item of items) itemStore.put(item)
    for (const entry of history) historyStore.put(entry)
  } catch (error) {
    // Without this a failed put would still commit the two clears.
    tx.abort()
    throw error
  }
  await done(tx)
}

/** Deletes an item together with its history entries. */
export async function deleteItem(id: string): Promise<void> {
  const tx = (await open()).transaction(['items', 'history'], 'readwrite')
  tx.objectStore('items').delete(id)
  const history = tx.objectStore('history')
  const keys = history.index('itemId').getAllKeys(id)
  keys.onsuccess = () => {
    for (const key of keys.result) history.delete(key)
  }
  await done(tx)
}
