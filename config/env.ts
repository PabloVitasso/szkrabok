export const env = {
  project: process.env.PLAYWRIGHT_PROJECT,
  preset: process.env.SZKRABOK_PRESET ?? 'default',
  session: process.env.SZKRABOK_SESSION ?? 'playwright-default',
  cdpEndpoint: process.env.SZKRABOK_CDP_ENDPOINT ?? '',
  ci: !!process.env.CI,
}
