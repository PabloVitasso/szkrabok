// AUTO-GENERATED — do not edit manually.
// Regenerate: npm run codegen:mcp
// Last generated: 2026-02-25T11:36:12.105Z
// Tools: 53  Hash: 62c51c023077

import { createHash } from 'node:crypto';
import { spawnClient } from './runtime/transport.js';
import { createCallInvoker } from './runtime/invoker.js';
import { createLogger } from './runtime/logger.js';
import * as adapter from './adapters/szkrabok-session.js';

const REGISTRY_HASH = '62c51c023077';

/**
 * @typedef {Object} McpHandle
 *   session: {
    open({ url, launchOptions }): Promise<any>
    close({ save }): Promise<any>
    list({  }): Promise<any>
    delete({  }): Promise<any>
    endpoint({  }): Promise<any>
  }
 *   nav: {
    goto({ url, wait }): Promise<any>
    back({  }): Promise<any>
    forward({  }): Promise<any>
  }
 *   interact: {
    click({ selector }): Promise<any>
    type({ selector, text }): Promise<any>
    select({ selector, value }): Promise<any>
  }
 *   extract: {
    text({ selector }): Promise<any>
    html({ selector }): Promise<any>
    screenshot({ path, fullPage }): Promise<any>
    evaluate({ code, args }): Promise<any>
  }
 *   workflow: {
    login({ username, password }): Promise<any>
    fillForm({ fields }): Promise<any>
    scrape({ selectors }): Promise<any>
  }
 *   browser: {
    snapshot({  }): Promise<any>
    click({ element, ref, doubleClick, button, modifiers }): Promise<any>
    type({ element, ref, text, submit, slowly }): Promise<any>
    navigate({ url }): Promise<any>
    navigate_back({  }): Promise<any>
    close({  }): Promise<any>
    drag({ startElement, startRef, endElement, endRef }): Promise<any>
    hover({ element, ref }): Promise<any>
    evaluate({ function, element, ref }): Promise<any>
    select_option({ element, ref, values }): Promise<any>
    fill_form({ fields }): Promise<any>
    press_key({ key }): Promise<any>
    take_screenshot({ type, filename, element, ref, fullPage }): Promise<any>
    wait_for({ time, text, textGone }): Promise<any>
    resize({ width, height }): Promise<any>
    tabs({ action, index }): Promise<any>
    console_messages({ level }): Promise<any>
    network_requests({ includeStatic }): Promise<any>
    file_upload({ paths }): Promise<any>
    handle_dialog({ accept, promptText }): Promise<any>
    run_code({ code }): Promise<any>
    run_test({ grep, params, config, keepOpen }): Promise<any>
    run_file({ path, fn, args }): Promise<any>
    mouse_click_xy({ element, x, y }): Promise<any>
    mouse_move_xy({ element, x, y }): Promise<any>
    mouse_drag_xy({ element, startX, startY, endX, endY }): Promise<any>
    pdf_save({ filename }): Promise<any>
    generate_locator({ element, ref }): Promise<any>
    verify_element_visible({ role, accessibleName }): Promise<any>
    verify_text_visible({ text }): Promise<any>
    verify_list_visible({ element, ref, items }): Promise<any>
    verify_value({ type, element, ref, value }): Promise<any>
    start_tracing({  }): Promise<any>
    stop_tracing({  }): Promise<any>
    install({  }): Promise<any>
  }
 */

/**
 * Connect to MCP server and get a typed handle.
 * @param {string} sessionName - Session name for szkrabok
 * @param {object} [customAdapter] - Optional custom adapter
 * @param {object} [options] - Connection options
 * @param {boolean} [options.sidecarEnabled=false] - Enable sidecar file logging
 * @param {object} [options.launchOptions] - Browser launch options forwarded to session.open
 * @returns {Promise<McpHandle>}
 */
export async function mcpConnect(sessionName, customAdapter = adapter, options = {}) {
  const client = await spawnClient();

  // Validate registry hasn't drifted
  const liveTools = await client.listTools();
  const liveHash = registryHash(liveTools.tools);
  if (liveHash !== REGISTRY_HASH) {
    await client.close();
    throw new Error('MCP registry drift detected. Run npm run codegen:mcp');
  }

  const log = createLogger({ sidecarEnabled: options.sidecarEnabled });
  const { invoke, close } = createCallInvoker({
    client,
    log,
    adapter: customAdapter,
    sessionName,
  });

  // Open session — forward launchOptions if provided
  await customAdapter.open(client, sessionName, options.launchOptions);

  return {
    close,
    session: {
      open: async (args = {}) => invoke('session.open', args),
      close: async (args = {}) => invoke('session.close', args),
      list: async () => invoke('session.list'),
      delete: async () => invoke('session.delete'),
      endpoint: async () => invoke('session.endpoint'),
    },
    nav: {
      goto: async (args = {}) => invoke('nav.goto', args),
      back: async () => invoke('nav.back'),
      forward: async () => invoke('nav.forward'),
    },
    interact: {
      click: async (args = {}) => invoke('interact.click', args),
      type: async (args = {}) => invoke('interact.type', args),
      select: async (args = {}) => invoke('interact.select', args),
    },
    extract: {
      text: async (args = {}) => invoke('extract.text', args),
      html: async (args = {}) => invoke('extract.html', args),
      screenshot: async (args = {}) => invoke('extract.screenshot', args),
      evaluate: async (args = {}) => invoke('extract.evaluate', args),
    },
    workflow: {
      login: async (args = {}) => invoke('workflow.login', args),
      fillForm: async (args = {}) => invoke('workflow.fillForm', args),
      scrape: async (args = {}) => invoke('workflow.scrape', args),
    },
    browser: {
      snapshot: async () => invoke('browser.snapshot'),
      click: async (args = {}) => invoke('browser.click', args),
      type: async (args = {}) => invoke('browser.type', args),
      navigate: async (args = {}) => invoke('browser.navigate', args),
      navigate_back: async () => invoke('browser.navigate_back'),
      close: async () => invoke('browser.close'),
      drag: async (args = {}) => invoke('browser.drag', args),
      hover: async (args = {}) => invoke('browser.hover', args),
      evaluate: async (args = {}) => invoke('browser.evaluate', args),
      select_option: async (args = {}) => invoke('browser.select_option', args),
      fill_form: async (args = {}) => invoke('browser.fill_form', args),
      press_key: async (args = {}) => invoke('browser.press_key', args),
      take_screenshot: async (args = {}) => invoke('browser.take_screenshot', args),
      wait_for: async (args = {}) => invoke('browser.wait_for', args),
      resize: async (args = {}) => invoke('browser.resize', args),
      tabs: async (args = {}) => invoke('browser.tabs', args),
      console_messages: async (args = {}) => invoke('browser.console_messages', args),
      network_requests: async (args = {}) => invoke('browser.network_requests', args),
      file_upload: async (args = {}) => invoke('browser.file_upload', args),
      handle_dialog: async (args = {}) => invoke('browser.handle_dialog', args),
      run_code: async (args = {}) => invoke('browser.run_code', args),
      run_test: async (args = {}) => invoke('browser.run_test', args),
      run_file: async (args = {}) => invoke('browser.run_file', args),
      mouse_click_xy: async (args = {}) => invoke('browser.mouse_click_xy', args),
      mouse_move_xy: async (args = {}) => invoke('browser.mouse_move_xy', args),
      mouse_drag_xy: async (args = {}) => invoke('browser.mouse_drag_xy', args),
      pdf_save: async (args = {}) => invoke('browser.pdf_save', args),
      generate_locator: async (args = {}) => invoke('browser.generate_locator', args),
      verify_element_visible: async (args = {}) => invoke('browser.verify_element_visible', args),
      verify_text_visible: async (args = {}) => invoke('browser.verify_text_visible', args),
      verify_list_visible: async (args = {}) => invoke('browser.verify_list_visible', args),
      verify_value: async (args = {}) => invoke('browser.verify_value', args),
      start_tracing: async () => invoke('browser.start_tracing'),
      stop_tracing: async () => invoke('browser.stop_tracing'),
      install: async () => invoke('browser.install'),
    },
  };
}

/**
 * Compute registry hash for drift detection.
 * @param {Array} tools
 * @returns {string}
 */
function registryHash(tools) {
  const canonical = tools
    .map(t => ({ name: t.name, inputSchema: t.inputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return createHash('sha1')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, 12);
}