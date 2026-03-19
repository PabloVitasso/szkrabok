export function register(program, { safe, getRuntime, attachShutdown }) {
  program
    .command('open <profile>')
    .description('Launch persistent browser and print CDP endpoint. With --clone: ephemeral copy, destroyed on exit')
    .option('--preset <preset>')
    .option('--headless')
    .option('--clone', 'clone the template profile into an ephemeral copy; clone dir deleted on exit')
    .action(
      safe(async (profile, options) => {
        const runtime = await getRuntime();

        if (options.clone) {
          const handle = await runtime.launchClone({
            profile,
            preset: options.preset,
            headless: options.headless ?? undefined,
          });
          console.log(`clone: ${handle.cloneId}`);
          console.log(handle.cdpEndpoint);
          attachShutdown(handle);
        } else {
          const handle = await runtime.launch({
            profile,
            preset: options.preset,
            headless: options.headless ?? undefined,
            reuse: false,
          });
          console.log(handle.cdpEndpoint);
          attachShutdown(handle);
        }

        await new Promise(() => {});
      })
    );
}
