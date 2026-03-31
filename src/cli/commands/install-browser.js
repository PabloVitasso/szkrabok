import {
  buildCandidates,
  populateCandidates,
  resolveChromium,
} from '#runtime';

export function register(program, ctx) {
  program
    .command('install-browser')
    .description('Install Chromium via Playwright')
    .action(async () => {
      const { spawn } = await import('node:child_process');

      await new Promise((resolve) => {
        const proc = spawn('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });

        proc.on('error', (err) => {
          process.stderr.write(
            `\nFailed to run npx: ${err.message}\nRun: szkrabok doctor\n`
          );
          ctx.setExitCode(1);
          resolve();
        });

        proc.on('close', async code => {
          if (code !== 0) {
            process.stderr.write(
              `\nInstallation failed (exit code ${code}). Run: szkrabok doctor\n`
            );
            ctx.setExitCode(code ?? 1);
            resolve();
            return;
          }

          // Post-install integrity check
          const candidates = buildCandidates({});
          await populateCandidates(candidates);
          const result = resolveChromium(candidates);

          if (result.found && result.source === 'playwright') {
            console.log(`\nChromium installed successfully (playwright-managed).`);
            console.log(`  Path: ${result.path}`);
            console.log(`\n  Tip: To use system Chrome instead of downloading:`);
            console.log(`    export CHROMIUM_PATH=/usr/bin/google-chrome`);
          } else if (result.found) {
            console.log(`\nChromium resolved via ${result.source}: ${result.path}`);
            console.log(`  (playwright-managed binary not found — using ${result.source} instead)`);
            console.log(`\n  Tip: To use system Chrome instead of downloading:`);
            console.log(`    export CHROMIUM_PATH=/usr/bin/google-chrome`);
          } else {
            process.stderr.write(
              `\nInstallation may have failed — playwright-managed Chromium not found after install.\n` +
              `Run: szkrabok doctor\n`
            );
            ctx.setExitCode(1);
          }

          resolve();
        });
      });
    });
}
