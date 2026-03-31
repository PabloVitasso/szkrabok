export function register(program, { safe }) {
  program
    .command('init')
    .description('Scaffold minimal config')
    .action(
      safe(async () => {
        const { init } = await import('../../tools/scaffold.js');

        const result = await init({
          dir: process.cwd(),
          preset: 'minimal',
          install: false,
        });

        if (result.created.length) console.error(`Created: ${result.created.join(', ')}`);
        if (result.merged.length) console.error(`Merged: ${result.merged.join(', ')}`);
        if (result.skipped.length) console.error(`Skipped: ${result.skipped.join(', ')}`);
        for (const w of result.warnings) console.error(`Warning: ${w}`);

        console.error('Done. Run "szkrabok doctor install" if Chromium is not installed.');
      })
    );
}
