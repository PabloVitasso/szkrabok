import * as pool from '../core/pool.js';

const INJECT_SCRIPT = `
  window.__mcp = window.__mcp || {};
  if (!window.__mcp.refs) {
    window.__mcp.refs = new Map();
    window.__mcp.counter = 0;
  }

  window.__mcp.reset = () => {
    window.__mcp.refs.clear();
    window.__mcp.counter = 0;
  };

  window.__mcp.getRef = (el) => {
    const ref = 'e' + (++window.__mcp.counter);
    window.__mcp.refs.set(ref, el);
    return ref;
  };

  window.__mcp.getElement = (ref) => {
    return window.__mcp.refs.get(ref);
  };

  window.__mcp.snapshot = () => {
    window.__mcp.reset();
    
    function isVisible(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function getLabel(el) {
      return (
        el.innerText || 
        el.getAttribute('aria-label') || 
        el.getAttribute('placeholder') || 
        el.value || 
        el.getAttribute('alt') || 
        ''
      ).replace(/\\s+/g, ' ').trim().substring(0, 100);
    }

    function traverse(node, depth = 0) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/\\s+/g, ' ').trim();
        if (text.length > 0) return '  '.repeat(depth) + text;
        return null;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      
      const el = node;
      if (!isVisible(el)) return null;

      const tag = el.tagName.toLowerCase();
      const label = getLabel(el);
      
      let output = [];
      let isInteractive = false;
      
      if (
        tag === 'a' || 
        tag === 'button' || 
        tag === 'input' || 
        tag === 'select' || 
        tag === 'textarea' ||
        el.getAttribute('role') === 'button' ||
        el.onclick ||
        el.getAttribute('tabindex') === '0'
      ) {
        isInteractive = true;
        const ref = window.__mcp.getRef(el);
        output.push(\`\${'  '.repeat(depth)}- \${tag} "\${label}" [ref=\${ref}]\`);
      }

      const children = [];
      for (const child of el.childNodes) {
        const res = traverse(child, depth + (isInteractive ? 1 : 0));
        if (res) children.push(res);
      }
      
      if (output.length === 0) {
        return children.join('\\n');
      }
      
      if (children.length > 0) {
        output.push(children.join('\\n'));
      }
      
      return output.join('\\n');
    }

    return traverse(document.body);
  };
`;

const ensureScript = async page => {
  await page.evaluate(INJECT_SCRIPT);
};

// Core automation tools
export const snapshot = async args => {
  const { sessionName } = args;
  const session = pool.get(sessionName);
  await ensureScript(session.page);

  const snap = await session.page.evaluate(() => window['__mcp'].snapshot());
  return { snapshot: snap, url: session.page.url() };
};

export const click = async args => {
  const { sessionName, ref, element, button = 'left', doubleClick = false, modifiers = [] } = args;
  const session = pool.get(sessionName);
  await ensureScript(session.page);

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref);
  const el = handle.asElement();

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`);
  }

  if (doubleClick) {
    await el.dblclick({ button, modifiers });
  } else {
    await el.click({ button, modifiers });
  }

  return { success: true, ref, element, url: session.page.url() };
};

export const type = async args => {
  const { sessionName, ref, element, text, submit = false, slowly = false } = args;
  const session = pool.get(sessionName);
  await ensureScript(session.page);

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref);
  const el = handle.asElement();

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`);
  }

  if (slowly) {
    await el.pressSequentially(text, { delay: 100 });
  } else {
    await el.fill(text);
  }

  if (submit) {
    await el.press('Enter');
  }

  return { success: true, ref, element, text, url: session.page.url() };
};

export const navigate = async args => {
  const { sessionName, url } = args;
  const session = pool.get(sessionName);

  await session.page.goto(url, { waitUntil: 'domcontentloaded' });
  const snap = await snapshot({ sessionName });
  return { ...snap, url: session.page.url() };
};

export const navigate_back = async args => {
  const { sessionName } = args;
  const session = pool.get(sessionName);

  await session.page.goBack({ waitUntil: 'domcontentloaded' });
  return { success: true, url: session.page.url() };
};

export const close = async args => {
  const { sessionName } = args;
  const session = pool.get(sessionName);

  await session.page.close();
  return { success: true, sessionName };
};

export const drag = async args => {
  const { sessionName, startRef, startElement, endRef, endElement } = args;
  const session = pool.get(sessionName);
  await ensureScript(session.page);

  const startHandle = await session.page.evaluateHandle(
    r => window['__mcp'].getElement(r),
    startRef
  );
  const endHandle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), endRef);

  const start = startHandle.asElement();
  const end = endHandle.asElement();

  if (!start || !end) {
    throw new Error('Start or end element not found');
  }

  await start.dragTo(end);
  return { success: true, startElement, endElement, url: session.page.url() };
};

export const hover = async args => {
  const { sessionName, ref, element } = args;
  const session = pool.get(sessionName);
  await ensureScript(session.page);

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref);
  const el = handle.asElement();

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`);
  }

  await el.hover();
  return { success: true, ref, element: element || '', url: session.page.url() };
};

export const evaluate = async args => {
  const { sessionName, function: fn, ref } = args;
  const session = pool.get(sessionName);

  let result;
  if (ref) {
    await ensureScript(session.page);
    const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref);
    const el = handle.asElement();
    if (!el) {
      throw new Error(`Element with ref ${ref} not found`);
    }
    result = await el.evaluate(fn);
  } else {
    result = await session.page.evaluate(fn);
  }

  return { result, url: session.page.url() };
};

export const select_option = async args => {
  const { sessionName, ref, element, values } = args;
  const session = pool.get(sessionName);
  await ensureScript(session.page);

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref);
  const el = handle.asElement();

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`);
  }

  await el.selectOption(values);
  return { success: true, ref, element, values, url: session.page.url() };
};

export const fill_form = async args => {
  const { sessionName, fields } = args;
  const session = pool.get(sessionName);
  await ensureScript(session.page);

  for (const field of fields) {
    const { ref, value } = field;
    const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref);
    const el = handle.asElement();

    if (!el) {
      throw new Error(`Element with ref ${ref} not found`);
    }

    await el.fill(value);
  }

  return { success: true, count: fields.length, url: session.page.url() };
};

export const press_key = async args => {
  const { sessionName, key } = args;
  const session = pool.get(sessionName);

  await session.page.keyboard.press(key);
  return { success: true, key, url: session.page.url() };
};

export const take_screenshot = async args => {
  const { sessionName, type = 'png', filename, ref, fullPage = false } = args;
  const session = pool.get(sessionName);

  if (ref) {
    await ensureScript(session.page);
    const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref);
    const el = handle.asElement();
    if (!el) {
      throw new Error(`Element with ref ${ref} not found`);
    }
    await el.screenshot({ type, path: filename });
  } else {
    await session.page.screenshot({ type, path: filename, fullPage });
  }

  return { success: true, filename, type, url: session.page.url() };
};

export const wait_for = async args => {
  const { sessionName, time, text, textGone } = args;
  const session = pool.get(sessionName);

  if (time) {
    await session.page.waitForTimeout(time * 1000);
    return { success: true, waited: time };
  }

  if (text) {
    await session.page.waitForSelector(`text=${text}`, { state: 'visible' });
    return { success: true, text };
  }

  if (textGone) {
    await session.page.waitForSelector(`text=${textGone}`, { state: 'hidden' });
    return { success: true, textGone };
  }

  return { success: false, error: 'No wait condition specified' };
};

export const resize = async args => {
  const { sessionName, width, height } = args;
  const session = pool.get(sessionName);

  await session.page.setViewportSize({ width, height });
  return { success: true, width, height };
};

export const tabs = async args => {
  const { sessionName, action, index } = args;
  const session = pool.get(sessionName);

  const pages = session.context.pages();

  if (action === 'list') {
    return {
      tabs: pages.map((p, i) => ({ index: i, url: p.url(), active: p === session.page })),
    };
  }

  if (action === 'new') {
    const newPage = await session.context.newPage();
    return { success: true, index: pages.length, url: newPage.url() };
  }

  if (action === 'close') {
    const pageToClose = index !== undefined ? pages[index] : session.page;
    if (!pageToClose) {
      throw new Error(`No page at index ${index}`);
    }
    await pageToClose.close();
    return { success: true, index };
  }

  if (action === 'select') {
    if (index === undefined) {
      throw new Error('index required for select action');
    }
    const pageToSelect = pages[index];
    if (!pageToSelect) {
      throw new Error(`No page at index ${index}`);
    }
    pool.add(sessionName, session.context, pageToSelect);
    return { success: true, index, url: pageToSelect.url() };
  }

  throw new Error(`Unknown action: ${action}`);
};

export const console_messages = async args => {
  const { sessionName, level = 'info' } = args;
  const session = pool.get(sessionName);

  const messages = await session.page.evaluate(lvl => {
    const levels = ['error', 'warning', 'info', 'debug'];
    const threshold = levels.indexOf(lvl);
    const logs = window['__consoleLogs'];
    return logs?.filter?.(log => levels.indexOf(log.level) <= threshold) || [];
  }, level);

  return { messages, url: session.page.url() };
};

export const network_requests = async args => {
  const { sessionName, includeStatic = false } = args;
  const session = pool.get(sessionName);

  const requests = await session.page.evaluate(incStatic => {
    const reqs = window['__networkRequests'];
    return (
      reqs?.filter?.(
        req => incStatic || !req.url.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf)$/)
      ) || []
    );
  }, includeStatic);

  return { requests, url: session.page.url() };
};

export const file_upload = async args => {
  const { sessionName, paths = [] } = args;
  const session = pool.get(sessionName);

  const [fileChooser] = await Promise.all([session.page.waitForEvent('filechooser')]);

  if (paths.length === 0) {
    await fileChooser.cancel();
  } else {
    await fileChooser.setFiles(paths);
  }

  return { success: true, files: paths.length };
};

export const handle_dialog = async args => {
  const { sessionName, accept, promptText } = args;
  const session = pool.get(sessionName);

  session.page.once('dialog', async dialog => {
    if (accept) {
      await dialog.accept(promptText);
    } else {
      await dialog.dismiss();
    }
  });

  return { success: true, action: accept ? 'accept' : 'dismiss' };
};

export const run_code = async args => {
  const { sessionName, code } = args;
  const session = pool.get(sessionName);

  const fn = eval(`(${code})`);
  const result = await fn(session.page);

  return { result, url: session.page.url() };
};

// Vision tools (coordinate-based)
export const mouse_click_xy = async args => {
  const { sessionName, element, x, y } = args;
  const session = pool.get(sessionName);

  await session.page.mouse.click(x, y);
  return { success: true, element, x, y, url: session.page.url() };
};

export const mouse_move_xy = async args => {
  const { sessionName, element, x, y } = args;
  const session = pool.get(sessionName);

  await session.page.mouse.move(x, y);
  return { success: true, element, x, y, url: session.page.url() };
};

export const mouse_drag_xy = async args => {
  const { sessionName, element, startX, startY, endX, endY } = args;
  const session = pool.get(sessionName);

  await session.page.mouse.move(startX, startY);
  await session.page.mouse.down();
  await session.page.mouse.move(endX, endY);
  await session.page.mouse.up();

  return { success: true, element, startX, startY, endX, endY, url: session.page.url() };
};

// PDF tools
export const pdf_save = async args => {
  const { sessionName, filename } = args;
  const session = pool.get(sessionName);

  const path = filename || `page-${Date.now()}.pdf`;
  await session.page.pdf({ path });

  return { success: true, filename: path };
};

// Testing tools
export const generate_locator = async args => {
  const { sessionName, ref, element } = args;
  const session = pool.get(sessionName);
  await ensureScript(session.page);

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref);
  const el = handle.asElement();

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`);
  }

  const locator = await session.page.locator(el).toString();
  return { locator, element, ref };
};

export const verify_element_visible = async args => {
  const { sessionName, role, accessibleName } = args;
  const session = pool.get(sessionName);

  const locator = session.page.getByRole(role, { name: accessibleName });
  await locator.waitFor({ state: 'visible' });

  return { success: true, role, accessibleName };
};

export const verify_text_visible = async args => {
  const { sessionName, text } = args;
  const session = pool.get(sessionName);

  const locator = session.page.getByText(text);
  await locator.waitFor({ state: 'visible' });

  return { success: true, text };
};

export const verify_list_visible = async args => {
  const { sessionName, ref, element, items } = args;
  const session = pool.get(sessionName);
  await ensureScript(session.page);

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref);
  const el = handle.asElement();

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`);
  }

  const actualItems = await el.evaluate(listEl => {
    return Array.from(listEl.children).map(child => child.textContent.trim());
  });

  const matches = items.every(item => actualItems.includes(item));

  return { success: matches, element, expectedItems: items, actualItems };
};

export const verify_value = async args => {
  const { sessionName, type, ref, element, value } = args;
  const session = pool.get(sessionName);
  await ensureScript(session.page);

  const handle = await session.page.evaluateHandle(r => window['__mcp'].getElement(r), ref);
  const el = handle.asElement();

  if (!el) {
    throw new Error(`Element with ref ${ref} not found`);
  }

  let actualValue;
  if (type === 'checkbox') {
    actualValue = await el.isChecked();
    const expectedValue = value === 'true';
    return { success: actualValue === expectedValue, element, expectedValue, actualValue };
  } else {
    actualValue = await el.inputValue();
    return { success: actualValue === value, element, expectedValue: value, actualValue };
  }
};

// Tracing tools
export const start_tracing = async args => {
  const { sessionName } = args;
  const session = pool.get(sessionName);

  await session.context.tracing.start({ screenshots: true, snapshots: true });
  return { success: true };
};

export const stop_tracing = async args => {
  const { sessionName } = args;
  const session = pool.get(sessionName);

  const path = `trace-${Date.now()}.zip`;
  await session.context.tracing.stop({ path });

  return { success: true, path };
};

export const install = async () => {
  // Browser installation handled by playwright
  return { success: true, message: 'Browsers managed by Playwright' };
};
