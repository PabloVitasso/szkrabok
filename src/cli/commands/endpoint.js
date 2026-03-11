import { endpoint } from '../../tools/szkrabok_session.js';

export function register(program, { safe }) {
  program
    .command('endpoint <sessionName>')
    .description('Print CDP and WS endpoints')
    .action(
      safe(async sessionName => {
        const result = await endpoint({ sessionName });
        console.log(`CDP: ${result.cdpEndpoint}`);
        if (result.wsEndpoint) console.log(`WS:  ${result.wsEndpoint}`);
      })
    );
}
