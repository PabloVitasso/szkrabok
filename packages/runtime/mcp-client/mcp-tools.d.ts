// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: 2026-10-24T19:23:57.623Z

export interface SessionHandle {
  /**
   * [szkrabok] Manage browser sessions. Actions: open (launch/resume), close (save/delete), list (all), delete (templates, exact name), endpoint (CDP/WS). 'open' + 'isClone:true' returns a clone ID; use this ID for subsequent calls.
   * @param args.url URL to navigate after opening. open only
   * @param args.launchOptions open only. Use preset OR individual fields (userAgent, viewport, locale, timezone). isClone creates an ephemeral clone. headless and stealth always allowed
   */
  manage(args: {
    action: 'open' | 'close' | 'list' | 'delete' | 'endpoint';
    url?: string;
    launchOptions?: Record<string, unknown>;
  }): Promise<unknown>;

  /**
   * [szkrabok] Composite: open/clone session → navigate → run test → apply post-policy. Single deterministic command. mode:"clone" (default) is ephemeral; mode:"template" persists. templateConflict:"clone-from-live" clones without closing template. Failure phases: session | test | postPolicy.
   */
  run_test(args: {
    session: Record<string, unknown>;
    test: Record<string, unknown>;
    postPolicy?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface BrowserHandle {
  /**
   * [szkrabok] Scrape current page into LLM-ready text. Returns raw blocks, llmFriendly string, and stats. selectors match content elements OR containers: text is returned for every matching element and everything inside it. Read-only (never modifies the page); boilerplate (nav/footer/ads/cookies) is skipped. Omit selectors to auto-scrape main/body
   * @param args.selectors CSS selectors: matched elements and their content are scraped. Omit for auto-mode (main or body).
   */
  scrape(args: {
    selectors?: string[];
  }): Promise<unknown>;

  /**
   * [Node mode: code is (page, args) => ...] [playwright-mcp] Execute Playwright JS on session page. Pass code (inline snippet) or path (.mjs file). Either evaluates/imports to a function (page, args) or an object of named exports; fn selects which export, defaults to "default". args is forwarded as the 2nd param.
   * @param args.path Absolute or relative path to an .mjs script file
   * @param args.fn Named export to call. Defaults to "default".
   * @param args.args Arguments passed as second parameter to the function
   */
  run(args: {
    code?: string;
    path?: string;
    fn?: string;
    args?: Record<string, unknown>;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Worker concurrency. Default: Playwright. session_run_test overrides to 1
   * @param args.grep Filter tests by name (regex)
   * @param args.params Key/value params passed to the spec as SZKRABOK_PARAM_<KEY> env vars, key uppercased (e.g. {url:"https://..."} → process.env.SZKRABOK_PARAM_URL). Keys must match ^[A-Z][A-Z0-9_]*$ after uppercasing; runtime, loader, package-manager and SZKRABOK_/PLAYWRIGHT_ names are reserved
   * @param args.config Config path relative to the spec root (--spec-root), or to the work root with --allow-node-code. Defaults to playwright.config.js
   * @param args.project Playwright project name to run (e.g. "automation"). Runs all projects if omitted.
   * @param args.files Spec files or directories to run (e.g. ["automation/rebrowser-check.spec.js"] or ["automation/"]). Relative to the spec root; with --allow-node-code, relative to the work root.
   * @param args.workers Number of parallel workers. Defaults to Playwright config value. session_run_test forces workers:1.
   * @param args.signalAttach Wait for fixture to confirm CDP attach before running tests. Default: false.
   * @param args.keepOpen After the test run, reconnect the session if the test subprocess invalidated the MCP context. Chrome stays alive; this restores the Playwright connection to it. Default false.
   * @param args.reportFile JSON report file name (no directories), written under <work-root>/reports/<sessionName>/. Default: last-run.json. Returns resolved path
   */
  run_test(args: {
    grep?: string;
    params?: Record<string, unknown>;
    config?: string;
    project?: string;
    files?: string[];
    workers?: number;
    signalAttach?: boolean;
    keepOpen?: boolean;
    reportFile?: string;
  }): Promise<unknown>;
}

export interface ScaffoldHandle {
  /**
   * [szkrabok] Init a szkrabok client project (idempotent). Run once before using browser_run_test. Two presets: minimal (default) — MCP-only setup, no local Playwright install needed, just config files and devDeps; full — adds automation/fixtures.js + example specs for running Playwright locally without MCP (standalone mode). Re-running is safe: unchanged files are skipped, modified files get a .new sidecar (dpkg-new convention).
   * @param args.dir Target directory. Defaults to cwd.
   * @param args.name Package name. Defaults to dirname.
   * @param args.preset minimal (default): playwright.config.js + package.json (devDeps only, no local szkrabok install needed) + szkrabok.config.toml (committed defaults) + szkrabok.config.local.toml (gitignored machine overrides). Use this when running specs via MCP (browser_run_test). full: everything in minimal + automation/fixtures.js + automation/example.spec.js + automation/example.mcp.spec.js — use when you also want to run Playwright locally without MCP (standalone mode, e.g. npx playwright test).
   * @param args.install Run npm install after writing files. Default false.
   */
  init(args: {
    dir?: string;
    name?: string;
    preset?: 'minimal' | 'full';
    install?: boolean;
  }): Promise<unknown>;
}

export interface McpHandle {
  close(): Promise<void>;
  readonly session: SessionHandle;
  readonly browser: BrowserHandle;
  readonly scaffold: ScaffoldHandle;
}

export declare function mcpConnect(
  sessionName: string,
  options?: {
    launchOptions?: Record<string, unknown>;
    sidecarEnabled?: boolean;
    adapter?: object;
  }
): Promise<McpHandle>;
