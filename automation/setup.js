import { resolvePreset } from '../src/config.js'

// Prints the resolved browser preset to console before automation tests run.
// Visible in both `browser.run_test` log output and CLI runs.
export default async function globalSetup() {
  const presetName = process.env.SZKRABOK_PRESET || 'default'
  const resolved = resolvePreset(presetName)

  const vp = resolved.viewport
  const vpStr = vp ? `${vp.width}×${vp.height}` : 'default'

  console.log(`[szkrabok] preset : ${resolved.preset} — ${resolved.label}`)
  console.log(
    `[szkrabok] viewport: ${vpStr}  locale: ${resolved.locale}  timezone: ${resolved.timezone}`
  )
  console.log(`[szkrabok] userAgent: ${resolved.userAgent}`)
}
