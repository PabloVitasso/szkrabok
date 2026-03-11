export function register(program, { safe, getRuntime, attachShutdown }) {
  program
    .command('open <profile>')
    .description('Launch persistent browser and print CDP endpoint')
    .option('--preset <preset>')
    .option('--headless')
    .action(
      safe(async (profile, options) => {
        const { launch } = await getRuntime();

        const handle = await launch({
          profile,
          preset: options.preset,
          headless: options.headless ?? undefined,
          reuse: false,
        });

        console.log(handle.cdpEndpoint);

        attachShutdown(handle);

        await new Promise(() => {});
      })
    );
}
