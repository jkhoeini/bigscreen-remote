// app.js — entry point. Wires protocol + settings + DOM.
import { createSession, sendKey, Key } from "./protocol.js";

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

let state = { phase: "disconnected", mode: "dpad", config: null };
const update = (patch) => { state = { ...state, ...patch }; render(state); };

const render = (s) => {
  const dot = $("[data-bind='status-dot']");
  const text = $("[data-bind='status-text']");
  const setupView = $("[data-view='setup']");
  const remoteView = $("[data-view='remote']");

  dot.className = "status-dot" + (
    s.phase === "connected" ? " connected" :
    s.phase === "connecting" || s.phase === "reconnecting" ? " connecting" : ""
  );

  const labels = {
    disconnected: "Disconnected",
    connecting: "Connecting…",
    connected: "Connected",
    reconnecting: "Reconnecting…",
    "auth-failed": "Auth failed — check secret",
  };
  text.textContent = labels[s.phase] ?? s.phase;

  setupView.hidden = s.phase === "connected";
  remoteView.hidden = s.phase !== "connected";
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

const bindEvents = () => {
  $("[data-action='connect']").addEventListener("click", handleConnect);

  $("[data-bind='host-input']").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleConnect();
  });

  $("[data-bind='secret-input']").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleConnect();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && session) session.reconnectNow();
  });
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
