// app.js — entry point. Wires protocol + settings + DOM.
import {
  createSession, Key,
  sendKey, sendMouseMove, sendMouseButton,
  sendScroll, sendScrollDone, sendText, sendEscape,
  makeDeltaAccumulator,
} from "./protocol.js";

// ============================================================
// DATA — settings persistence
// ============================================================

const STORAGE_KEY = "bigscreen-remote/v1";

const loadSettings = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; }
  catch { return {}; }
};

const saveSettings = (patch) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadSettings(), ...patch }));

// ============================================================
// UI — state, render, bindings
// ============================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let state = { phase: "disconnected", mode: "dpad", config: null, kbOpen: false };
const update = (patch) => { state = { ...state, ...patch }; render(state); };

const render = (s) => {
  const status = $("#status");
  const phaseClass = s.phase === "reconnecting" ? "connecting" : s.phase;
  status.className = phaseClass;

  const setupEls = $$("[data-view='setup']");
  const remoteEls = $$("[data-view='remote']");
  const isConnected = s.phase === "connected";

  setupEls.forEach((el) => { el.hidden = isConnected; });
  remoteEls.forEach((el) => {
    if (el.id === "keyboard-panel") {
      el.hidden = !(isConnected && s.kbOpen);
      return;
    }
    el.hidden = !isConnected;
  });

  const kbBtn = $("[data-action='keyboard']");
  if (kbBtn) kbBtn.classList.toggle("is-active", s.kbOpen && isConnected);
};

let session = null;

const startSession = (host, secret) => {
  if (session) session.stop();
  session = createSession(host, secret, (phase, config) => {
    update({ phase, ...(config ? { config } : {}) });
  });
  session.start();
};

const handleConnect = () => {
  const hostInput = $("[data-bind='host-input']");
  const secretInput = $("[data-bind='secret-input']");
  const host = hostInput.value.trim();
  const secret = secretInput.value.trim();
  if (!host) { hostInput.focus(); return; }

  saveSettings({ host, secret });
  startSession(host, secret);
};

const handleSettings = () => {
  if (session) session.stop();
  update({ phase: "disconnected", kbOpen: false });
};

const sendForKey = (name) => {
  if (name === "ESCAPE") return (s) => s.send(sendEscape);
  if (Key[name] !== undefined) return (s) => s.send(sendKey, Key[name]);
  return null;
};

const bindKeyButtons = () => {
  const repeats = new Map();

  const startRepeat = (btn, fn) => {
    if (repeats.has(btn)) return;
    fn();
    const initial = setTimeout(() => {
      const iv = setInterval(fn, 80);
      repeats.set(btn, { timer: iv, type: "interval" });
    }, 150);
    repeats.set(btn, { timer: initial, type: "timeout" });
  };

  const stopRepeat = (btn) => {
    const r = repeats.get(btn);
    if (!r) return;
    r.type === "interval" ? clearInterval(r.timer) : clearTimeout(r.timer);
    repeats.delete(btn);
  };

  document.getElementById("app").addEventListener("pointerdown", (e) => {
    const btn = e.target.closest("[data-key]");
    if (!btn || !session) return;
    e.preventDefault();

    const fn = sendForKey(btn.dataset.key);
    if (!fn) return;

    if (btn.dataset.repeat != null) {
      startRepeat(btn, () => fn(session));
    } else {
      fn(session);
    }
  });

  const stopAll = (e) => {
    const btn = e.target.closest("[data-key]");
    if (btn) stopRepeat(btn);
  };

  for (const evt of ["pointerup", "pointercancel", "pointerleave"]) {
    document.getElementById("app").addEventListener(evt, stopAll);
  }
};

const bindTouchpad = () => {
  const pad = $("#touchpad");
  if (!pad) return;

  const pointers = new Map();
  let lastTap = 0;
  let moved = false;
  let scrolling = false;

  const accum = makeDeltaAccumulator((dx, dy) => {
    if (session) session.send(sendMouseMove, dx, dy);
  });

  const scrollAccum = makeDeltaAccumulator((dx, dy) => {
    if (session) session.send(sendScroll, dx, dy);
  });

  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    scrolling = pointers.size >= 2;
    pad.classList.add("is-touching");
  });

  pad.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    e.preventDefault();

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;

    if (scrolling && pointers.size >= 2) {
      scrollAccum(-dx, -dy);
    } else if (!scrolling) {
      accum(dx, dy);
    }
  });

  const onUp = (e) => {
    const wasInMap = pointers.delete(e.pointerId);
    if (!wasInMap) return;

    if (pointers.size === 0) {
      pad.classList.remove("is-touching");

      if (scrolling) {
        if (session) session.send(sendScrollDone);
        scrolling = false;
      } else if (!moved) {
        const now = Date.now();
        const btn = (now - lastTap < 300) ? 2 : 0;
        lastTap = now;
        if (session) {
          session.send(sendMouseButton, btn, true);
          setTimeout(() => session.send(sendMouseButton, btn, false), 50);
        }
      }
    }

    if (pointers.size < 2) scrolling = false;
  };

  pad.addEventListener("pointerup", onUp);
  pad.addEventListener("pointercancel", onUp);
};

const bindKeyboard = () => {
  const kbBtn = $("[data-action='keyboard']");
  const panel = $("#keyboard-panel");
  const input = $("#kb-input");
  if (!kbBtn || !panel || !input) return;

  kbBtn.addEventListener("click", () => {
    const opening = !state.kbOpen;
    update({ kbOpen: opening });
    if (opening) setTimeout(() => input.focus(), 50);
    else input.blur();
  });

  input.addEventListener("input", () => {
    const text = input.value;
    if (text && session) {
      session.send(sendText, text);
      input.value = "";
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (session) session.send(sendKey, Key.RETURN);
    }
    if (e.key === "Backspace" && !input.value) {
      e.preventDefault();
      if (session) session.send(sendKey, Key.BACKSPACE);
    }
  });
};

const bindEvents = () => {
  $("[data-action='connect']").addEventListener("click", handleConnect);

  $("[data-bind='host-input']").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleConnect();
  });

  $("[data-bind='secret-input']").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleConnect();
  });

  $("[data-action='settings']").addEventListener("click", handleSettings);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && session) session.reconnectNow();
  });

  bindKeyButtons();
  bindTouchpad();
  bindKeyboard();
};

const init = () => {
  render(state);
  bindEvents();

  const saved = loadSettings();
  if (saved.host) {
    $("[data-bind='host-input']").value = saved.host;
    $("[data-bind='secret-input']").value = saved.secret ?? "";
    startSession(saved.host, saved.secret ?? "");
  }
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
init();
