// protocol.js — remote-touchpad WebSocket protocol client
// Pure: knows WebSocket, HMAC-SHA256, wire format. Never touches DOM or localStorage.

export const Key = Object.freeze({
  VOLUME_MUTE: 0, VOLUME_DOWN: 1, VOLUME_UP: 2,
  MEDIA_PLAY_PAUSE: 3, MEDIA_PREV_TRACK: 4, MEDIA_NEXT_TRACK: 5,
  BROWSER_BACK: 6, BROWSER_FORWARD: 7, SUPER: 8,
  LEFT: 9, RIGHT: 10, UP: 11, DOWN: 12,
  HOME: 13, END: 14, BACKSPACE: 15, DELETE: 16, RETURN: 17,
});

const nextMessage = (ws, timeoutMs = 10000) =>
  new Promise((resolve, reject) => {
    const cleanup = () => { ws.removeEventListener("message", onMsg); ws.removeEventListener("close", onClose); clearTimeout(timer); };
    const onMsg = (e) => { cleanup(); resolve(e.data); };
    const onClose = () => { cleanup(); reject(new Error("closed")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, timeoutMs);
    ws.addEventListener("message", onMsg);
    ws.addEventListener("close", onClose);
  });

// HMAC-SHA256: key=challenge, message=secret (matches upstream's unusual convention)
const hmacSha256 = async (key, message) => {
  const enc = new TextEncoder();
  if (globalThis.crypto?.subtle) {
    const cryptoKey = await crypto.subtle.importKey(
      "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }
  return hmacSha256Fallback(key, message);
};

const hmacSha256Fallback = (key, message) => {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(key);
  const msgBytes = enc.encode(message);
  const BLOCK = 64;
  const k = keyBytes.length > BLOCK ? sha256(keyBytes) : keyBytes;
  const pad = new Uint8Array(BLOCK);
  pad.set(k);
  const ipad = pad.map((b) => b ^ 0x36);
  const opad = pad.map((b) => b ^ 0x5c);
  const inner = new Uint8Array(BLOCK + msgBytes.length);
  inner.set(ipad); inner.set(msgBytes, BLOCK);
  const outer = new Uint8Array(BLOCK + 32);
  outer.set(opad); outer.set(sha256(inner), BLOCK);
  return btoa(String.fromCharCode(...sha256(outer)));
};

const sha256 = (data) => {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const padMsg = (msg) => {
    const bits = msg.length * 8;
    const padded = new Uint8Array(Math.ceil((msg.length + 9) / 64) * 64);
    padded.set(msg);
    padded[msg.length] = 0x80;
    new DataView(padded.buffer).setUint32(padded.length - 4, bits, false);
    return padded;
  };
  const padded = padMsg(data instanceof Uint8Array ? data : new TextEncoder().encode(data));
  let [h0,h1,h2,h3,h4,h5,h6,h7] = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const view = new DataView(padded.buffer);
  for (let off = 0; off < padded.length; off += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15]>>>3);
      const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2]>>>10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let [a,b,c,d,e,f,g,h] = [h0,h1,h2,h3,h4,h5,h6,h7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0;
    h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+h)|0;
  }
  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  dv.setUint32(0,h0); dv.setUint32(4,h1); dv.setUint32(8,h2); dv.setUint32(12,h3);
  dv.setUint32(16,h4); dv.setUint32(20,h5); dv.setUint32(24,h6); dv.setUint32(28,h7);
  return out;
};

class AuthError extends Error { constructor() { super("auth-failed"); this.name = "AuthError"; } }

export const connect = async (httpUrl, secret) => {
  const url = new URL("/ws", httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  console.log("[remote] connecting to", url.href);
  const ws = new WebSocket(url);
  ws.addEventListener("error", (e) => console.error("[remote] ws error", e));
  ws.addEventListener("close", (e) => console.log("[remote] ws close", e.code, e.reason));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("connection-failed")); });
  const challenge = await nextMessage(ws);
  ws.send(await hmacSha256(challenge, secret));
  let config;
  try {
    const raw = await nextMessage(ws, 5000);
    config = JSON.parse(raw);
  } catch (e) {
    try { ws.close(); } catch {}
    if (e.message === "closed") throw new AuthError();
    throw e;
  }
  return Object.freeze({ ws, config });
};

const sendRaw = (conn, cmd) =>
  conn.ws.readyState === WebSocket.OPEN && (conn.ws.send(cmd), true);

export const sendKey         = (conn, key)         => sendRaw(conn, `k${key}`);
export const sendMouseMove   = (conn, dx, dy)      => sendRaw(conn, `m${Math.trunc(dx)};${Math.trunc(dy)}`);
export const sendScroll      = (conn, dh, dv)      => sendRaw(conn, `s${Math.trunc(dh)};${Math.trunc(dv)}`);
export const sendScrollDone  = (conn)              => sendRaw(conn, "S");
export const sendMouseButton = (conn, btn, press)  => sendRaw(conn, `b${btn};${press ? 1 : 0}`);
export const sendText        = (conn, text)        => sendRaw(conn, `t${text}`);
export const sendEscape      = (conn)              => sendText(conn, "\x1b");
export const sendTab         = (conn)              => sendText(conn, "\t");
export const disconnect      = (conn)              => conn.ws.close();

export const makeDeltaAccumulator = (emit) => {
  let rx = 0, ry = 0;
  return (dx, dy) => {
    rx += dx; ry += dy;
    const ix = Math.trunc(rx), iy = Math.trunc(ry);
    if (ix || iy) { rx -= ix; ry -= iy; emit(ix, iy); }
  };
};

export const createSession = (httpUrl, secret, onChange) => {
  let conn = null;
  let attempt = 0;
  let timer = null;
  let epoch = 0;

  const backoff = () => Math.min(500 * 2 ** attempt, 10000) * (0.8 + Math.random() * 0.4);

  const tryConnect = async () => {
    const my = ++epoch;
    clearTimeout(timer);
    onChange("connecting");
    try {
      const c = await connect(httpUrl, secret);
      if (my !== epoch) { disconnect(c); return; }
      conn = c;
      attempt = 0;
      onChange("connected", c.config);
      c.ws.addEventListener("close", () => {
        if (my !== epoch) return;
        conn = null;
        attempt++;
        onChange("reconnecting");
        timer = setTimeout(tryConnect, backoff());
      });
    } catch (e) {
      console.error("[remote] connect failed:", e.message, "attempt:", attempt);
      if (my !== epoch) return;
      conn = null;
      if (e instanceof AuthError) { onChange("auth-failed"); return; }
      attempt++;
      timer = setTimeout(tryConnect, backoff());
    }
  };

  return Object.freeze({
    start: tryConnect,
    stop: () => { epoch++; clearTimeout(timer); if (conn) { disconnect(conn); conn = null; } },
    send: (fn, ...args) => conn ? fn(conn, ...args) : false,
    reconnectNow: () => { if (!conn) { attempt = 0; tryConnect(); } },
  });
};
