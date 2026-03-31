// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: 2026-03-31T14:42:10.839Z

export interface SessionHandle {
  /**
   * [szkrabok] Manage browser sessions. Actions: open (launch/resume), close (save/delete), list (all), delete (templates; globs support), endpoint (CDP/WS). 'open' + 'isClone:true' returns a clone ID; use this ID for subsequent calls.
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
   * [szkrabok] Scrape current page into LLM-ready text. Returns raw blocks and llmFriendly string. selectors: optional CSS selectors to target specific areas; omit for auto (main/body)
   * @param args.selectors CSS selectors to target. Omit for auto-mode (main or body).
   */
  scrape(args: {
    selectors?: string[];
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Execute Playwright JS on session page. Pass code (inline snippet) or path (named export from .mjs file with (page, args)). fn defaults to "default".
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
   * @param args.params Key/value params passed as uppercased env vars to the spec (e.g. {url:"https://..."} → URL)
   * @param args.config Config path relative to repo root. Defaults to playwright.config.js
   * @param args.project Playwright project name to run (e.g. "automation"). Runs all projects if omitted.
   * @param args.files File or directory paths passed as positional args to playwright test (e.g. ["automation/rebrowser-check.spec.js"] or ["automation/"]). Relative to repo root.
   * @param args.workers Number of parallel workers. Defaults to Playwright config value. session_run_test forces workers:1.
   * @param args.signalAttach Wait for fixture to confirm CDP attach before running tests. Default: false.
   * @param args.keepOpen After the test run, reconnect the session if the test subprocess invalidated the MCP context. Chrome stays alive; this restores the Playwright connection to it. Default false.
   * @param args.reportFile Repo-relative JSON report path. Default: sessions/<sessionName>/last-run.json. Returns resolved path
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
   * @param args.preset minimal (default): playwright.config.js + package.json (devDeps only, no local szkrabok install needed) + szkrabok.config.local.toml.example. Use this when running specs via MCP (browser_run_test). full: everything in minimal + automation/fixtures.js + automation/example.spec.js + automation/example.mcp.spec.js — use when you also want to run Playwright locally without MCP (standalone mode, e.g. npx playwright test).
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
