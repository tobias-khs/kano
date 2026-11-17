import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { build } from './build.ts'

const dist = new URL('../dist/', import.meta.url)
const port = Number(process.env.PORT ?? 8080)

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

await build()

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  const file = new URL(`.${path.endsWith('/') ? `${path}index.html` : path}`, dist)
  if (!file.href.startsWith(dist.href)) {
    res.writeHead(403).end()
    return
  }
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': types[extname(file.pathname)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
}).listen(port, () => console.log(`http://localhost:${port}`))
