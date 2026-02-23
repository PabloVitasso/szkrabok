/*
 * inspect-page — generic page table + iframe inspector
 *
 * Navigates to a URL (or uses the current page) and returns a compact
 * snapshot of all table rows and iframe contents. Useful for exploring
 * unknown pages before writing assertions, or for ad-hoc debugging.
 *
 * Usage via browser.run_file:
 *
 *   browser.run_file {
 *     "id": "<session>",
 *     "path": "playwright-tests/scripts/inspect-page.mjs",
 *     "args": {
 *       "url":        "https://example.com",  // optional — omit to use current page
 *       "wait":       "table tr",             // optional CSS selector to wait for
 *       "settle":     1000,                   // optional extra ms after wait (default 1000)
 *       "minCols":    2,                      // optional min tds per row to include (default 2)
 *       "nameCol":    0,                      // optional td index for row name  (default 0)
 *       "valueCol":  -1,                      // optional td index for row value (default -1 = last)
 *       "statusCol": -1,                      // optional td index whose class is used for filtering
 *                                             //   (default -1 = same as valueCol)
 *       "filterCls":  "error|warning",        // optional regex — only keep rows where statusCol
 *                                             //   class matches (omit to return all rows)
 *       "filterText": "FAIL",                 // optional regex — only keep rows where value matches
 *       "iframes":    true                    // optional — scan iframe contents (default true)
 *     }
 *   }
 *
 * Returns:
 *   {
 *     rows:    [{ name, value, cls }],          // one entry per matching <tr>
 *     iframes: [{ url, rows: [{name,value,cls}] }]  // per-frame row snapshot (non-empty only)
 *   }
 *
 * Token tips:
 *   - Use filterCls or filterText to return only interesting rows.
 *   - Set iframes: false if you don't need frame content.
 *   - valueCol and statusCol accept negative indexes (-1 = last, -2 = second-to-last, etc.)
 */

export default async (page, args = {}) => {
  const {
    url,
    wait,
    settle    = 1000,
    minCols   = 2,
    nameCol   = 0,
    valueCol  = -1,
    statusCol = -1,
    filterCls,
    filterText,
    iframes: scanIframes = true,
  } = args;

  if (url) await page.goto(url);
  if (wait) await page.waitForSelector(wait, { timeout: 15000 });
  if (settle > 0) await page.waitForTimeout(settle);

  const opts = {
    minCols, nameCol, valueCol, statusCol,
    filterCls: filterCls ?? null, filterText: filterText ?? null,
  };

  const extractRows = (opts) => {
    const pick = (arr, idx) => arr[idx < 0 ? arr.length + idx : idx];
    const reCls  = opts.filterCls  ? new RegExp(opts.filterCls)  : null;
    const reText = opts.filterText ? new RegExp(opts.filterText) : null;
    return [...document.querySelectorAll('tr')].flatMap(tr => {
      const tds = [...tr.querySelectorAll('td')];
      if (tds.length < opts.minCols) return [];
      const nameTd   = pick(tds, opts.nameCol);
      const valueTd  = pick(tds, opts.valueCol);
      const statusTd = pick(tds, opts.statusCol) ?? valueTd;
      if (!nameTd || !valueTd) return [];
      const cls = statusTd.className.trim();
      const val = valueTd.textContent.trim();
      if (reCls  && !reCls.test(cls))  return [];
      if (reText && !reText.test(val)) return [];
      return [{ name: nameTd.textContent.trim(), value: val, cls }];
    });
  };

  const rows = await page.evaluate(extractRows, opts);

  const iframeResults = [];
  if (scanIframes) {
    for (const frame of page.frames().slice(1)) {
      try {
        const frameRows = await frame.evaluate(extractRows, opts);
        if (frameRows.length) iframeResults.push({ url: frame.url(), rows: frameRows });
      } catch (_) { /* cross-origin or empty — skip */ }
    }
  }

  return { rows, iframes: iframeResults };
};
