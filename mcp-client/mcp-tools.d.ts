// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: 2026-02-25T19:34:24.776Z

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

export interface NavHandle {
  /**
   * [szkrabok] Navigate to URL
   */
  goto(args: {
    url: string;
    wait?: 'load' | 'domcontentloaded' | 'networkidle';
  }): Promise<unknown>;

  /**
   * [szkrabok] Go back
   */
  back(): Promise<unknown>;

  /**
   * [szkrabok] Go forward
   */
  forward(): Promise<unknown>;
}

export interface InteractHandle {
  /**
   * [szkrabok] Click element
   */
  click(args: {
    selector: string;
  }): Promise<unknown>;

  /**
   * [szkrabok] Type text
   */
  type(args: {
    selector: string;
    text: string;
  }): Promise<unknown>;

  /**
   * [szkrabok] Select dropdown option
   */
  select(args: {
    selector: string;
    value: string;
  }): Promise<unknown>;
}

export interface ExtractHandle {
  /**
   * [szkrabok] Extract text
   */
  text(args: {
    selector?: string;
  }): Promise<unknown>;

  /**
   * [szkrabok] Extract HTML
   */
  html(args: {
    selector?: string;
  }): Promise<unknown>;

  /**
   * [szkrabok] Take screenshot
   */
  screenshot(args: {
    path?: string;
    fullPage?: boolean;
  }): Promise<unknown>;

  /**
   * [szkrabok] Execute JavaScript
   */
  evaluate(args: {
    code: string;
    args?: string[];
  }): Promise<unknown>;
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
   * [playwright-mcp] Capture accessibility snapshot of the current page
   */
  snapshot(): Promise<unknown>;

  /**
   * [playwright-mcp] Click element using ref from snapshot
   */
  click(args: {
    element: string;
    ref: string;
    doubleClick?: boolean;
    button?: 'left' | 'right' | 'middle';
    modifiers?: string[];
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Type text using ref from snapshot
   */
  type(args: {
    element: string;
    ref: string;
    text: string;
    submit?: boolean;
    slowly?: boolean;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Navigate to URL and return an accessibility snapshot
   */
  navigate(args: {
    url: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Go back to the previous page
   */
  navigate_back(): Promise<unknown>;

  /**
   * [playwright-mcp] Close the page
   */
  close(): Promise<unknown>;

  /**
   * [playwright-mcp] Drag and drop between two elements
   */
  drag(args: {
    startElement: string;
    startRef: string;
    endElement: string;
    endRef: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Hover over element
   */
  hover(args: {
    element: string;
    ref: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Evaluate JavaScript expression
   */
  evaluate(args: {
    function: string;
    element?: string;
    ref?: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Select option in dropdown
   */
  select_option(args: {
    element: string;
    ref: string;
    values: string[];
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Fill multiple form fields
   */
  fill_form(args: {
    fields: Record<string, unknown>[];
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Press a key
   */
  press_key(args: {
    key: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Take screenshot
   */
  take_screenshot(args: {
    type?: 'png' | 'jpeg';
    filename?: string;
    element?: string;
    ref?: string;
    fullPage?: boolean;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Wait for a timeout, text to appear, or text to disappear
   */
  wait_for(args: {
    time?: number;
    text?: string;
    textGone?: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Resize browser window
   */
  resize(args: {
    width: number;
    height: number;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Manage tabs
   */
  tabs(args: {
    action: 'list' | 'new' | 'close' | 'select';
    index?: number;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Get console messages
   */
  console_messages(args: {
    level?: 'error' | 'warning' | 'info' | 'debug';
  }): Promise<unknown>;

  /**
   * [playwright-mcp] List network requests
   */
  network_requests(args: {
    includeStatic?: boolean;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Upload files
   */
  file_upload(args: {
    paths?: string[];
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Handle dialog
   */
  handle_dialog(args: {
    accept: boolean;
    promptText?: string;
  }): Promise<unknown>;

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

  /**
   * [playwright-mcp] Click at coordinates
   */
  mouse_click_xy(args: {
    element: string;
    x: number;
    y: number;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Move mouse to coordinates
   */
  mouse_move_xy(args: {
    element: string;
    x: number;
    y: number;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Drag mouse between coordinates
   */
  mouse_drag_xy(args: {
    element: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Save page as PDF
   */
  pdf_save(args: {
    filename?: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Generate locator for element
   */
  generate_locator(args: {
    element: string;
    ref: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Verify element is visible
   */
  verify_element_visible(args: {
    role: string;
    accessibleName: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Verify text is visible
   */
  verify_text_visible(args: {
    text: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Verify list is visible
   */
  verify_list_visible(args: {
    element: string;
    ref: string;
    items: string[];
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Verify element value
   */
  verify_value(args: {
    type: string;
    element: string;
    ref: string;
    value: string;
  }): Promise<unknown>;

  /**
   * [playwright-mcp] Start trace recording
   */
  start_tracing(): Promise<unknown>;

  /**
   * [playwright-mcp] Stop trace recording
   */
  stop_tracing(): Promise<unknown>;

  /**
   * [playwright-mcp] Install browser
   */
  install(): Promise<unknown>;
}

export interface McpHandle {
  close(): Promise<void>;
  readonly session: SessionHandle;
  readonly nav: NavHandle;
  readonly interact: InteractHandle;
  readonly extract: ExtractHandle;
  readonly workflow: WorkflowHandle;
  readonly browser: BrowserHandle;
}

export declare function mcpConnect(
  sessionName: string,
  customAdapter?: object,
  options?: {
    sidecarEnabled?: boolean;
    launchOptions?: Record<string, unknown>;
  }
): Promise<McpHandle>;
