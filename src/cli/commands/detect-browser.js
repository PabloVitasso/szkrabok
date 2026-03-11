export function register(program, { safe, getRuntime }) {
  program
    .command('detect-browser')
    .description('Detect Chrome/Chromium')
    .action(
      safe(async () => {
        const { findChromiumPath } = await getRuntime();
        const chromiumPath = await findChromiumPath();

        if (!chromiumPath) {
          console.log('No Chromium detected\n');
          console.log('  szkrabok install-browser');
          process.exit(1);
        }

        console.log(chromiumPath);
        console.log('\nRecommended config:\n');
        console.log('[default]');
        console.log(`executablePath = "${chromiumPath}"`);
      })
    );
}
