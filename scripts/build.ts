import { stripTypeScriptTypes } from 'node:module'
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const dist = new URL('dist/', root)

export async function build(): Promise<void> {
  await rm(dist, { recursive: true, force: true })
  await cp(new URL('public/', root), dist, { recursive: true })

  const files = (await readdir(new URL('src/', root))).filter((f) => f.endsWith('.ts'))
  for (const file of files) {
    const source = await readFile(new URL(`src/${file}`, root), 'utf8')
    const js = stripTypeScriptTypes(source).replace(/(from\s+['"]\.[^'"]*)\.ts(['"])/g, '$1.js$2')
    await writeFile(new URL(file.replace(/\.ts$/, '.js'), dist), js)
  }

  // A new cache name per build makes the service worker drop the old app shell.
  const sw = new URL('sw.js', dist)
  await writeFile(sw, (await readFile(sw, 'utf8')).replace('__BUILD__', String(Date.now())))
}

if (import.meta.main) await build()
