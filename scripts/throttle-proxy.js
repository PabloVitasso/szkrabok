#!/usr/bin/env node
// throttle-proxy.js
// Rate-limited reverse proxy for `playwright install` browser downloads.
// Playwright honours PLAYWRIGHT_DOWNLOAD_HOST and appends its own CDN path to it,
// so pointing that at this proxy caps download speed without touching the CLI.
//
//   node scripts/throttle-proxy.js                 # 800 KiB/s on 127.0.0.1:8899
//   RATE_BYTES_PER_SEC=2000000 PORT=9000 node scripts/throttle-proxy.js
//   PLAYWRIGHT_DOWNLOAD_HOST=http://127.0.0.1:8899 npx playwright install chromium firefox
//
// Runs until killed. The rate applies per connection; playwright downloads
// browsers one at a time, so the aggregate stays at the configured rate.

import http from 'http'

const PORT = Number(process.env.PORT || 8899)
const RATE = Number(process.env.RATE_BYTES_PER_SEC || 800 * 1024)
const ORIGIN = process.env.ORIGIN || 'https://cdn.playwright.dev'
const HOST = process.env.HOST || '127.0.0.1'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const handle = async (req, res) => {
  const url = ORIGIN + req.url
  const started = Date.now()
  let bytes = 0

  let upstream
  try {
    upstream = await fetch(url, { redirect: 'follow' })
  } catch (error) {
    console.error(`[throttle-proxy] ${url}: ${error.message}`)
    res.writeHead(502)
    res.end()
    return
  }

  if (!upstream.ok || !upstream.body) {
    console.error(`[throttle-proxy] ${upstream.status} ${url}`)
    res.writeHead(upstream.status || 502)
    res.end()
    return
  }

  const headers = {
    'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
  }
  const length = upstream.headers.get('content-length')
  if (length) headers['content-length'] = length
  console.log(`[throttle-proxy] GET ${req.url} -> ${upstream.status} ${length ?? '?'} bytes`)
  res.writeHead(upstream.status, headers)

  try {
    for await (const chunk of upstream.body) {
      if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve))
      bytes += chunk.length
      // Sleeping after each write adds to the time the write itself takes, so the
      // measured rate lands ~5% under RATE. Fine for a throttle; no token bucket needed.
      await sleep((chunk.length / RATE) * 1000)
    }
    res.end()
    const seconds = (Date.now() - started) / 1000
    console.log(
      `[throttle-proxy] done ${bytes} bytes in ${seconds.toFixed(1)}s ` +
        `(${(bytes / seconds / 1024).toFixed(0)} KiB/s)`
    )
  } catch (error) {
    console.error(`[throttle-proxy] stream aborted: ${error.message}`)
    try {
      res.destroy()
    } catch {
      /* client already gone */
    }
  }
}

http
  .createServer(handle)
  .listen(PORT, HOST, () =>
    console.error(
      `[throttle-proxy] listening on ${HOST}:${PORT} at ${(RATE / 1024).toFixed(0)} KiB/s -> ${ORIGIN}`
    )
  )
