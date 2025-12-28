import { test } from 'node:test'
import assert from 'node:assert'
import Ajv from 'ajv'
import { registerTools } from '../tools/registry.js'

const ajv = new Ajv.default({ strict: true, validateSchema: true })

test('all tool schemas should be valid JSON Schema', () => {
  const tools = registerTools()

  for (const tool of tools) {
    try {
      const valid = ajv.validateSchema(tool.inputSchema)
      assert.ok(
        valid,
        `Schema for ${tool.name} is invalid: ${JSON.stringify(ajv.errors, null, 2)}`
      )
    } catch (err) {
      assert.fail(`Schema validation for ${tool.name} threw error: ${err.message}`)
    }
  }
})

test('array properties must have items defined', () => {
  const tools = registerTools()

  for (const tool of tools) {
    const schema = tool.inputSchema
    checkArrayItemsRecursively(schema, tool.name)
  }
})

function checkArrayItemsRecursively(obj, toolName, path = '') {
  if (obj && typeof obj === 'object') {
    if (obj.type === 'array') {
      assert.ok(
        'items' in obj,
        `${toolName}: Array at ${path || 'root'} is missing 'items' property`
      )
    }

    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key
      checkArrayItemsRecursively(value, toolName, newPath)
    }
  }
}
