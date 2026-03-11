export function register(program) {
  program
    .command('install-browser')
    .description('Install Chromium via Playwright')
    .action(() => {
      import('node:child_process').then(({ spawn }) => {
        const proc = spawn('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });
        proc.on('close', code => process.exit(code ?? 0));
      });
    });
}
