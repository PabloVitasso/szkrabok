import { test } from 'node:test'
import assert from 'node:assert'
import * as pool from '../../src/core/pool.js'
import * as storage from '../../src/core/storage.js'

test('pool operations', () => {
  const mockContext = { id: 'test' }
  const mockPage = { url: () => 'https://bot.sannysoft.com/' }

  pool.add('test', mockContext, mockPage)
  assert.ok(pool.has('test'))

  const session = pool.get('test')
  assert.strictEqual(session.context, mockContext)
  assert.strictEqual(session.page, mockPage)

  // print page url to console
  console.log('page url:', session.page.url())

  pool.remove('test')
  assert.ok(!pool.has('test'))
})

test('pool throws on missing session', () => {
  assert.throws(() => pool.get('nonexistent'), /Session not found/)
})

test('storage paths', async () => {
  await storage.ensureSessionsDir()
  const exists = storage.sessionExists('nonexistent')
  assert.strictEqual(exists, false)
})

test('list returns empty array initially', () => {
  const sessions = pool.list()
  assert.ok(Array.isArray(sessions))
})
