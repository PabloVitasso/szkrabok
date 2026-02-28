/**
 * Generate a timestamped filename.
 * @param {string} label - e.g. 'p4n-dump'
 * @param {string} [ext='json']
 * @param {string} [dir='/tmp']
 * @returns {string} absolute path like /tmp/202602282308-p4n-dump.json
 */
export function timestampedPath(label, ext = 'json', dir = '/tmp') {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${dir}/${stamp}-${label}.${ext}`;
}
