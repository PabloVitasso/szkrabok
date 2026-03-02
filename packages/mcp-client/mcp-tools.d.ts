// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: 2026-03-02T00:48:41.563Z

export interface SessionHandle {
  /**
   * [szkrabok] Open or resume a browser session
   * @param args.launchOptions Browser launch options — preset, stealth, headless, viewport, userAgent, locale, timezone, disableWebGL
   */
  open(args: {
    url?: string;
    launchOptions?: Record<string, unknown>;
  }): Promise<unknown>;

  /**
   * [szkrabok] Close and save session
   */
  close(args: {
    save?: boolean;
  }): Promise<unknown>;

  /**
   * [szkrabok] List all sessions
   */
  list(): Promise<unknown>;

  /**
   * [szkrabok] Delete session permanently
   */
  delete(): Promise<unknown>;

  /**
   * [szkrabok] Get Playwright WebSocket endpoint for external script connection
   */
  endpoint(): Promise<unknown>;
}

export interface WorkflowHandle {
  /**
   * [szkrabok] Automated login
   */
  login(args: {
    username: string;
    password: string;
  }): Promise<unknown>;

  /**
   * [szkrabok] Fill form
   */
  fillForm(args: {
    fields: Record<string, unknown>;
  }): Promise<unknown>;

  /**
   * [szkrabok] Scrape structured data
   */
  scrape(args: {
    selectors: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface BrowserHandle {
  /**
   * [playwright-mcp] Execute a Playwright script string against the session page
   */
  run_code(args: {
    code: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Run Playwright .spec.js tests and return JSON results. Connects to the session browser via CDP. IMPORTANT: session.open must be called first.
   * @param args.grep Filter tests by name (regex)
   * @param args.params Key/value params passed as TEST_* env vars to the spec (e.g. {url:"https://..."} → TEST_URL)
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

  /**
   * [playwright-mcp] Run a named export from a Playwright ESM .mjs script against the session page. Function receives (page, args) and must return a JSON-serialisable value. IMPORTANT: session.open must be called first.
   * @param args.path Absolute or relative path to an .mjs script file
   * @param args.fn Named export to call. Defaults to "default".
   * @param args.args Arguments passed as second parameter to the function
   */
  run_file(args: {
    path: string;
    fn?: string;
    args?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface McpHandle {
  close(): Promise<void>;
  readonly session: SessionHandle;
  readonly workflow: WorkflowHandle;
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
