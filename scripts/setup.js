import { mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

const dirs = ['sessions', 'logs']

const setup = async () => {
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
      console.log(`Created ${dir}/`)
    }
  }

  console.log('Installing Playwright browsers...')
  try {
    execSync('npx playwright install chromium', { stdio: 'inherit' })
    console.log('Setup complete')
  } catch (err) {
    console.error('Browser install failed, run manually: npx playwright install chromium')
  }
}

setup().catch(console.error)