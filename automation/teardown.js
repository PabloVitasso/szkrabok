import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Saves storageState (cookies + localStorage) to the szkrabok session dir after test run.
// szkrabok can then load this state via session.open() + storageState import.
export default async function globalTeardown(_config) {
  const sessionId = process.env.SZKRABOK_SESSION ?? 'playwright-default';
  const stateFile = path.resolve(__dirname, '..', 'sessions', sessionId, 'storageState.json');

  // Teardown gets no page - we launch a fresh browser just to export context state.
  // If there's an existing state file (written by a test via page.context().storageState()),
  // this is a no-op. The state file is written by the test runner's context automatically
  // via the storageState fixture.

  // Ensure session directory exists so szkrabok picks it up in session.list()
  const sessionDir = path.dirname(stateFile);
  fs.mkdirSync(sessionDir, { recursive: true });

  const metaFile = path.join(sessionDir, 'meta.json');
  if (!fs.existsSync(metaFile)) {
    fs.writeFileSync(
      metaFile,
      JSON.stringify(
        {
          sessionName: sessionId,
          created: Date.now(),
          lastUsed: Date.now(),
          config: {},
        },
        null,
        2
      )
    );
  } else {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    meta.lastUsed = Date.now();
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  }
}
