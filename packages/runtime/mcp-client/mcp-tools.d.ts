// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: 2026-03-10T13:39:22.920Z

export interface _rootHandle {
  /**
   * [szkrabok] Manage browser sessions. action: open (launch/resume session), close (save+close), list (all stored), delete (remove data), endpoint (get CDP/WS URLs). open requires sessionName; list requires none; others require sessionName
   * @param args.launchOptions open only. Use either preset OR individual fields (userAgent, viewport, locale, timezone). headless and stealth always allowed.
   */
  session_manage(args: {
    action: 'open' | 'close' | 'list' | 'delete' | 'endpoint';
    url?: string;
    save?: boolean;
    launchOptions?: Record<string, unknown>;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Execute Playwright JS on session page. Pass code (inline snippet) or path (named export from .mjs file with (page, args)). fn defaults to "default".
   * @param args.path Absolute or relative path to an .mjs script file
   * @param args.fn Named export to call. Defaults to "default".
   * @param args.args Arguments passed as second parameter to the function
   */
  browser_run(args: {
    code?: string;
    path?: string;
    fn?: string;
    args?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface WorkflowHandle {
  /**
   * [szkrabok] Scrape current page into LLM-ready text. Returns raw blocks and llmFriendly string. selectors: optional CSS selectors to target specific areas; omit for auto (main/body)
   * @param args.selectors CSS selectors to target. Omit for auto-mode (main or body).
   */
  scrape(args: {
    selectors?: string[];
  }): Promise<unknown>;
}

export interface ScaffoldHandle {
  /**
   * [szkrabok] Init szkrabok project (idempotent). Prerequisite for browser runs. minimal (default): config/deps; full: automation fixtures and Playwright specs
   * @param args.dir Target directory. Defaults to cwd.
   * @param args.name Package name. Defaults to dirname.
   * @param args.preset minimal (default): config files only. full: + automation/fixtures.js + automation/example.spec.js + automation/example.mcp.spec.js
   * @param args.install Run npm install after writing files. Default false.
   */
  init(args: {
    dir?: string;
    name?: string;
    preset?: 'minimal' | 'full';
    install?: boolean;
  }): Promise<unknown>;
}

export interface BrowserHandle {
  /**
   * [playwright-mcp] Run .spec.js tests via CDP (returns JSON). Requires session_manage(open) and scaffold.init
   * @param args.grep Filter tests by name (regex)
   * @param args.params Key/value params passed as uppercased env vars to the spec (e.g. {url:"https://..."} → URL)
   * @param args.config Config path relative to repo root. Defaults to playwright.config.js
   * @param args.project Playwright project name to run (e.g. "automation"). Runs all projects if omitted.
   * @param args.files File or directory paths passed as positional args to playwright test (e.g. ["automation/rebrowser-check.spec.js"] or ["automation/"]). Relative to repo root.
   * @param args.keepOpen After the test run, reconnect the session if the test subprocess invalidated the MCP context. Chrome stays alive; this restores the Playwright connection to it. Default false.
   */
  run_test(args: {
    grep?: string;
    params?: Record<string, unknown>;
    config?: string;
    project?: string;
    files?: string[];
    keepOpen?: boolean;
  }): Promise<unknown>;
}

export interface McpHandle {
  close(): Promise<void>;
  readonly _root: _rootHandle;
  readonly workflow: WorkflowHandle;
  readonly scaffold: ScaffoldHandle;
  readonly browser: BrowserHandle;
}

export declare function mcpConnect(
  sessionName: string,
  options?: {
    launchOptions?: Record<string, unknown>;
    sidecarEnabled?: boolean;
    adapter?: object;
  }
): Promise<McpHandle>;
