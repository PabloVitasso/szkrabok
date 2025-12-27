#!/usr/bin/env node
import { createServer } from './server.js'
import { log, logError } from './utils/logger.js'

const server = createServer()

process.on('SIGINT', async () => {
  log('Shutting down gracefully...')
  await server.close()
  process.exit(0)
})

process.on('uncaughtException', err => {
  logError('Uncaught exception', err)
  process.exit(1)
})

server.connect().catch(err => {
  logError('Failed to start server', err)
  process.exit(1)
})