// Minimal Chrome DevTools Protocol driver for the browser checks.
//
// No npm dependency: Node's built-in WebSocket and fetch, and a headless Chrome
// (or Edge) launched on a free debugging port. `run.mjs` is the entry point;
// this file only knows how to start a browser and drive one tab.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

/** The browser binary to drive, or a plain explanation of what to install. */
export function findChrome() {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "no Chrome or Edge found; set CHROME_PATH to a Chromium-based browser executable",
  );
}

/** A port nothing is listening on right now. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Launch headless Chrome on a free debugging port and attach to one tab.
 * `outDir` receives screenshots; keep it outside the repo.
 */
export async function launch(url, { outDir = tmpdir() } = {}) {
  const chromePath = findChrome();
  const port = await freePort();
  const profile = join(tmpdir(), `codelens-chrome-${process.pid}-${port}`);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(profile, { recursive: true });

  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--window-size=1440,960",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const http = async (path, method = "GET") => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    return response.json();
  };

  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      await http("/json/version");
      break;
    } catch {
      await sleep(100);
    }
  }

  const target = await http(`/json/new?${encodeURIComponent(url)}`, "PUT");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("could not attach to the browser tab"));
  });

  let nextId = 0;
  const pending = new Map();
  const events = [];
  socket.onmessage = (message) => {
    const payload = JSON.parse(message.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) reject(new Error(JSON.stringify(payload.error)));
      else resolve(payload.result);
    } else if (payload.method) {
      events.push(payload);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "evaluate failed",
      );
    }
    return result.result.value;
  };

  const waitFor = async (expression, timeout = 60000, label = expression) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(`Boolean(${expression})`)) return true;
      await sleep(150);
    }
    throw new Error(`timeout waiting for ${label}`);
  };

  const click = (selector) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const clickText = (text) =>
    evaluate(`(() => {
      const el = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent.trim() === ${JSON.stringify(text)},
      );
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const setValue = (selector, value, prototype = "HTMLInputElement") =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(
        ${prototype}.prototype,
        "value",
      ).set;
      setter.call(el, ${JSON.stringify(String(value))});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);

  const screenshot = async (name) => {
    const result = await send("Page.captureScreenshot", { format: "png" });
    const path = join(outDir, `${name}.png`);
    writeFileSync(path, Buffer.from(result.data, "base64"));
    return path;
  };

  /** Console errors and warnings only: a clean run must return []. */
  const consoleMessages = () =>
    events
      .filter(
        (event) =>
          event.method === "Runtime.consoleAPICalled" ||
          event.method === "Log.entryAdded",
      )
      .map((event) => ({
        level: event.params.type ?? event.params.entry?.level ?? null,
        text:
          event.params.args
            ?.map((arg) => arg.value ?? arg.description)
            .join(" ") ??
          event.params.entry?.text ??
          "",
      }))
      .filter((entry) => entry.level === "error" || entry.level === "warning");

  const close = () => {
    try {
      socket.close();
    } catch {}
    try {
      chrome.kill();
    } catch {}
  };

  return {
    send,
    evaluate,
    waitFor,
    click,
    clickText,
    setValue,
    screenshot,
    consoleMessages,
    close,
  };
}

export { sleep };
