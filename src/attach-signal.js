import { writeFile, rename } from 'fs/promises';

// Best-effort atomic write: tmp → rename.
// rename() is atomic when source and dest are on the same filesystem (POSIX guarantee).
// Cross-filesystem moves (e.g. tmpfs → ext4) are NOT guaranteed atomic — this is a
// test coordination signal, not a durability guarantee. No fsync is issued.
// Throws on any write failure — no silent catch.
// No-op when path is empty or falsy.
export async function writeAttachSignal(path) {
  if (!path) return;
  const tmp = path + '.tmp';
  await writeFile(tmp, 'ok');
  await rename(tmp, path);
}
