import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'

const dirs = ['sessions', 'logs']

const setup = async () => {
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
      console.log(`Created ${dir}/`)
    }
  }

  console.log('szkrabok installed. No browser found? Run: szkrabok doctor install')
}

setup().catch(console.error)
