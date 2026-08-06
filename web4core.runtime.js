(() => {
  // src/parseuri.min.js
  var parseUri = (() => {
    var o = Object.defineProperty;
    var u = Object.getOwnPropertyDescriptor;
    var c = Object.getOwnPropertyNames;
    var d = Object.prototype.hasOwnProperty;
    var f = (t, e) => {
      for (var r in e) o(t, r, { get: e[r], enumerable: true });
    }, h = (t, e, r, a) => {
      if (e && typeof e == "object" || typeof e == "function") for (let s of c(e)) !d.call(t, s) && s !== r && o(t, s, { get: () => e[s], enumerable: !(a = u(e, s)) || a.enumerable });
      return t;
    };
    var p = (t) => h(o({}, "__esModule", { value: true }), t);
    var $ = {};
    f($, { parseUri: () => m, setTlds: () => y });
    function m(t, e = "default") {
      t = t.trim();
      let { groups: r } = i.parser[e].exec(t), { hasAuth: a, ...s } = { href: t, ...r, ...r.protocol && r.hasAuth == null ? g : null };
      return Object.keys(s).forEach((n) => s[n] ??= ""), Object.assign(s, { ...i.tlds?.exec(s.hostname)?.groups, queryParams: new URLSearchParams(`?${s.query}`) });
    }
    var g = { directory: "", filename: "", suffix: "" };
    function l(t) {
      let e = String.raw`(?:(?:(?<=^(?:https?|wss?|ftp):):*|^:+)[\\/]*|^[\\/]{2,}|//)`, r = { default: { start: `(?<hasAuth>${e}`, end: ")?" }, friendly: { start: `(?<hasAuth>${e}?)`, end: "" } };
      return RegExp(String.raw`^(?<origin>(?:(?<protocol>[a-z][^\s:@\\/?#.]*):)?${r[t].start}(?<authority>(?:(?<userinfo>(?<username>[^:@\\/?#]*)(?::(?<password>[^\\/?#]*))?)?@)?(?<host>(?<hostname>\d{1,3}(?:\.\d{1,3}){3}(?=[:\\/?#]|$)|\[[a-f\d]{0,4}(?::[a-f\d]{0,4}){2,7}(?:%[^\]]*)?\]|(?<subdomain>[^:\\/?#]*?)\.??(?<domain>(?:[^.:\\/?#]*\.)?(?<tld>[^.:\\/?#]*))(?=[:\\/?#]|$))?(?::(?<port>[^:\\/?#]*))?))${r[t].end})(?<resource>(?<pathname>(?<directory>(?:[^\\/?#]*[\\/])*)(?<filename>(?:[^.?#]+|\.(?![^.?#]+(?:[?#]|$)))*(?:\.(?<suffix>[^.?#]+))?))(?:\?(?<query>[^#]*))?(?:\#(?<fragment>.*))?)`, "i");
    }
    var i = { parser: { default: l("default"), friendly: l("friendly") } };
    function y(t) {
      let e = Object.entries(t), r;
      if (e.length) {
        let a = e.map(([s, n]) => `(?:${n.trim().replace(/\s+/g, "|").replace(/\./g, "\\.")})\\.${s}`).join("|");
        r = RegExp(`^(?<subdomain>.*?)\\.??(?<domain>(?:[^.]*\\.)?(?<tld>${a}))$`, "is");
      }
      i.tlds = r;
    }
    return p($);
  })();
  parseUri.parseUri.setTlds = parseUri.setTlds;
  globalThis.parseUri = parseUri.parseUri;

  // src/main.js
  function decodeBase64Url(input) {
    try {
      const s = input.replace(/-/g, "+").replace(/_/g, "/");
      const pad = s.length % 4 === 2 ? "==" : s.length % 4 === 3 ? "=" : "";
      return atob(s + pad);
    } catch {
      return "";
    }
  }
  function safeDecodeURIComponent(input) {
    const s = (input ?? "").toString();
    if (!s) return "";
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }
  function tryJSON(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
  function takeBase64Prefix(s) {
    const t = String(s || "").trim();
    if (!t) return "";
    const m = t.match(/^[A-Za-z0-9+/=_-]+/);
    return m ? m[0] : t;
  }
  function isHttpUrl(s) {
    try {
      const u = parseUrl((s || "").trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }
  function parseUrl(urlStr) {
    const raw = (urlStr || "").trim();
    if (!raw) throw new Error("Invalid URL");
    if (typeof globalThis !== "undefined" && typeof globalThis.parseUri === "function") {
      const parsed = globalThis.parseUri(raw, "default");
      const qp = parsed.queryParams || new URLSearchParams(parsed.query ? "?" + parsed.query : "");
      const scheme = (parsed.protocol || raw.split(":", 1)[0] || "").toLowerCase();
      return {
        href: parsed.href || raw,
        protocol: parsed.protocol ? parsed.protocol + ":" : scheme ? scheme + ":" : "",
        hostname: parsed.hostname || "",
        port: parsed.port || "",
        username: parsed.username || "",
        password: parsed.password || "",
        hash: parsed.fragment ? "#" + parsed.fragment : "",
        searchParams: qp
      };
    }
    if (typeof URL === "function") {
      const u = new URL(raw);
      return {
        href: u.href,
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        username: u.username,
        password: u.password,
        hash: u.hash,
        searchParams: u.searchParams
      };
    }
    throw new Error("URL parser not available");
  }
  var SUPPORTED_SCHEMES = [
    "vmess",
    "vless",
    "trojan",
    "anytls",
    "ss",
    "socks",
    "socks4",
    "socks4a",
    "socks5",
    "socks5h",
    "http",
    "https",
    "hy2",
    "hysteria2",
    "tuic",
    "tt",
    "mieru",
    "mierus",
    "sdns",
    "masque"
  ];
  var MAX_SUB_REDIRECTS = 2;
  var SUB_FETCH_TIMEOUT = 15e3;
  var PROXY_FETCH_INTERVAL = 300;
  var SUB_REFRESH_INTERVAL = 43200;
  var SUB_FALLBACK_RETRIES = 2;
  var URLTEST_LOGO_GOOGLE = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#fff"/><path d="M16.98 10.2c0-.43-.04-.75-.13-1.09H10v2.14h4.02c-.08.53-.5 1.33-1.44 1.86l-.01.07 2.09 1.58.14.01c1.26-1.13 2.18-2.79 2.18-4.57Z" fill="#4285F4"/><path d="M10 17.2c1.97 0 3.63-.64 4.84-1.74l-2.31-1.76c-.62.42-1.46.71-2.53.71-1.93 0-3.57-1.25-4.15-2.98l-.07.01-2.17 1.64-.02.07A7.31 7.31 0 0 0 10 17.2Z" fill="#34A853"/><path d="M5.85 11.43A4.3 4.3 0 0 1 5.61 10c0-.5.09-.99.23-1.43l-.01-.1-2.2-1.67-.07.03A7.15 7.15 0 0 0 2.8 10c0 1.14.28 2.22.76 3.17l2.29-1.74Z" fill="#FBBC05"/><path d="M10 5.59c1.34 0 2.25.57 2.77 1.05l2.02-1.93C13.62 3.65 11.97 2.8 10 2.8a7.31 7.31 0 0 0-6.44 3.85l2.28 1.72C6.43 6.84 8.07 5.59 10 5.59Z" fill="#EA4335"/></svg>';
  var URLTEST_LOGO_CLOUDFLARE = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" rx="10" fill="#fff" fill-opacity="0"/><path d="M14.18 11.17a2.22 2.22 0 0 0-2.18-2.61 3.02 3.02 0 0 0-5.76-.5 1.84 1.84 0 0 0-1.83 1.84c0 .14.02.27.05.4A1.78 1.78 0 0 0 5.3 13.8h8.58a1.32 1.32 0 0 0 .3-2.63Z" fill="#F38020"/><path d="M14.96 11.48a1.43 1.43 0 0 0-1.4-1.69 1.95 1.95 0 0 0-1.82 1.24 1.12 1.12 0 0 0-.72 2h3.78a.79.79 0 0 0 .16-1.55Z" fill="#FAAE40"/></svg>';
  var URLTEST_LOGO_APPLE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.53 10.53c.02 2 1.76 2.67 1.78 2.68-.01.04-.27.92-.89 1.82-.54.78-1.1 1.56-1.98 1.58-.87.02-1.16-.51-2.16-.51-1 0-1.33.49-2.09.53-.84.03-1.48-.84-2.03-1.61-1.13-1.58-2-4.48-.84-6.48.57-.99 1.6-1.62 2.72-1.64.85-.02 1.65.57 2.16.57.5 0 1.45-.7 2.45-.6.42.02 1.58.17 2.33 1.25-.06.04-1.39.8-1.38 2.41Zm-1.84-4.3c.45-.54.76-1.28.68-2.03-.66.03-1.46.43-1.94.97-.43.48-.8 1.23-.7 1.95.74.06 1.5-.38 1.96-.89Z" fill="#D0D3D8"/></svg>';
  var URLTEST_LOGO_MICROSOFT = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" fill="#F25022"/><rect x="10.5" y="2.5" width="7" height="7" fill="#7FBA00"/><rect x="2.5" y="10.5" width="7" height="7" fill="#00A4EF"/><rect x="10.5" y="10.5" width="7" height="7" fill="#FFB900"/></svg>';
  var URLTEST_LOGO_UBUNTU = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#E95420"/><circle cx="10" cy="10" r="2.1" fill="#fff"/><circle cx="5.1" cy="10" r="1.45" fill="#fff"/><circle cx="12.45" cy="5.76" r="1.45" fill="#fff"/><circle cx="12.45" cy="14.24" r="1.45" fill="#fff"/><path d="M6.5 10h2.1" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/><path d="M11.08 6.7l-1.05 1.82" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/><path d="m11.08 13.3-1.05-1.82" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/></svg>';
  var URLTEST_LOGO_FEDORA = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#294172"/><path d="M11.2 4.5c1.6 0 2.9 1.2 2.9 2.8 0 1.25-.8 2.3-1.95 2.67v2.75c0 1.57-1.31 2.8-2.94 2.8H7.85v-2.12h1.27c.49 0 .86-.37.86-.84v-3.9c0-1.54 1.26-2.8 2.83-2.8h1.33V4.5H11.2Zm-.3 3.54c-.48 0-.88.4-.88.88v.62h.88c.49 0 .89-.4.89-.88 0-.35-.21-.62-.52-.75a.86.86 0 0 0-.37-.07Z" fill="#fff"/></svg>';
  var URLTEST_CHOICES = [
    { id: "google", label: "Google", url: "https://google.com/generate_204", logo: URLTEST_LOGO_GOOGLE, expectedStatus: 204 },
    { id: "cloudflare", label: "Cloudflare", url: "https://cp.cloudflare.com/generate_204", logo: URLTEST_LOGO_CLOUDFLARE, expectedStatus: 204 },
    { id: "apple", label: "Apple", url: "https://captive.apple.com/hotspot-detect.html", logo: URLTEST_LOGO_APPLE, expectedStatus: 200 },
    { id: "microsoft", label: "Microsoft", url: "https://msftconnecttest.com/connecttest.txt", logo: URLTEST_LOGO_MICROSOFT, expectedStatus: 200 },
    { id: "ubuntu", label: "Ubuntu", url: "https://connectivity-check.ubuntu.com/", logo: URLTEST_LOGO_UBUNTU, expectedStatus: 200 },
    { id: "fedora", label: "Fedora", url: "https://fedoraproject.org/static/hotspot.txt", logo: URLTEST_LOGO_FEDORA, expectedStatus: 200 }
  ];
  var URLTEST = URLTEST_CHOICES[0].url;
  var URLTEST_INTERVAL = "3m";
  var FETCH_INIT = {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    headers: { "Accept": "text/plain, */*" },
    redirect: "follow"
  };
  var PUBLIC_CORS_FALLBACKS = [
    (x) => "https://sub.web2core.workers.dev/?url=" + encodeURIComponent(x)
  ];
  var CORE_PROTOCOL_SUPPORT = {
    singbox: {
      base: ["vmess", "vless", "trojan", "ss", "socks", "http", "hy2", "tuic", "anytls", "wireguard"],
      extendedOnly: ["mieru", "sdns"]
    },
    xray: {
      base: ["vmess", "vless", "trojan", "ss", "socks", "http", "hy2"]
    },
    mihomo: {
      base: ["vmess", "vless", "trojan", "ss", "socks", "http", "hy2", "tuic", "wireguard", "masque", "mieru", "trusttunnel"]
    }
  };
  function getAllowedCoreProtocols(core, options) {
    const c = String(core || "").toLowerCase();
    const cfg = CORE_PROTOCOL_SUPPORT[c];
    if (!cfg) return [];
    const useExtended = !!(options && options.useExtended);
    if (c === "singbox" && useExtended && Array.isArray(cfg.extendedOnly)) {
      return Array.from(/* @__PURE__ */ new Set([...cfg.base || [], ...cfg.extendedOnly]));
    }
    return Array.from(/* @__PURE__ */ new Set([...cfg.base || []]));
  }
  function splitCSV(str) {
    return (str || "").split(",").map((s) => safeDecodeURIComponent(s.trim())).filter(Boolean);
  }
  function getQuery(u) {
    return u.searchParams;
  }
  function getFirstTrimmedQueryValue(q, keys) {
    for (const key of keys) {
      const value = (q.get(key) || "").trim();
      if (value) return value;
    }
    return "";
  }
  function parseTlsQueryExtras(q) {
    return {
      certificatePublicKeySha256: getFirstTrimmedQueryValue(q, [
        "certificate_public_key_sha256",
        "certificate-public-key-sha256"
      ]),
      ech: {
        config: getFirstTrimmedQueryValue(q, ["echConfig", "ech-config", "ech_config"]),
        configPath: getFirstTrimmedQueryValue(q, ["echConfigPath", "ech-config-path", "ech_config_path"]),
        configList: getFirstTrimmedQueryValue(q, ["echConfigList", "ech-config-list", "ech_config_list"]),
        queryServerName: getFirstTrimmedQueryValue(q, ["echQueryServerName", "ech-query-server-name", "ech_query_server_name"]),
        forceQuery: getFirstTrimmedQueryValue(q, ["echForceQuery", "ech-force-query", "ech_force_query"])
      }
    };
  }
  function asInt(n, def = 0) {
    const x = parseInt(n, 10);
    return Number.isFinite(x) ? x : def;
  }
  function sanitizeTag(s) {
    const cleaned = (s || "").replace(/[\u0000-\u001f]/g, "").trim();
    return cleaned || "proxy";
  }
  function generateSecretHex32() {
    try {
      const buf = new Uint8Array(16);
      (self.crypto || window.crypto).getRandomValues(buf);
      return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      const bytes = [];
      for (let i = 0; i < 16; i++) bytes.push(Math.floor(Math.random() * 256));
      return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  }
  function computeTag(bean, used) {
    const base = sanitizeTag((bean.name || "").trim()) || sanitizeTag(`${bean.proto}-${bean.host}-${bean.port}`);
    let tag = base;
    let i = 1;
    while (used.has(tag)) {
      tag = `${base}-${++i}`;
    }
    used.add(tag);
    return tag;
  }
  function isValidUuid(str) {
    const s = (str || "").trim();
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);
  }
  function findUuidToken(str) {
    const s = (str || "").trim();
    if (!s) return "";
    const tokens = s.split(/[:@]/).map((x) => x.trim()).filter(Boolean);
    for (const t of tokens) {
      if (isValidUuid(t)) return t;
    }
    if (isValidUuid(s)) return s;
    return "";
  }
  function parseAddrHostPort(addr, defaultPort) {
    let host = "";
    let port = defaultPort;
    const a = (addr || "").trim();
    if (!a) return { host, port };
    if (a.startsWith("[")) {
      const ix = a.indexOf("]");
      if (ix !== -1) {
        host = a.slice(0, ix + 1);
        const rest = a.slice(ix + 1);
        if (rest.startsWith(":")) port = asInt(rest.slice(1), defaultPort);
      } else {
        host = a;
      }
    } else {
      const lastColon = a.lastIndexOf(":");
      if (lastColon > 0) {
        host = a.slice(0, lastColon);
        port = asInt(a.slice(lastColon + 1), defaultPort);
      } else {
        host = a;
      }
    }
    return { host, port };
  }
  function readTlsVarIntBinary(input, offset) {
    const source = String(input || "");
    if (!Number.isInteger(offset) || offset < 0 || offset >= source.length) {
      throw new Error("tt: invalid varint offset");
    }
    const first = source.charCodeAt(offset);
    const prefix = first >> 6;
    const size = 1 << prefix;
    if (offset + size > source.length) throw new Error("tt: truncated varint");
    let value = BigInt(first & 63);
    for (let i = 1; i < size; i++) {
      value = value << 8n | BigInt(source.charCodeAt(offset + i));
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("tt: varint too large");
    return { value: Number(value), nextOffset: offset + size };
  }
  function decodeAuthorityAndExtract(authority, defaultPort) {
    const dec = decodeBase64Url(authority || "");
    if (!dec || !dec.includes("@")) return null;
    const i = dec.lastIndexOf("@");
    const cred = dec.slice(0, i);
    const addr = dec.slice(i + 1);
    const uuid = findUuidToken(cred);
    const { host, port } = parseAddrHostPort(addr, defaultPort);
    return { uuid, host, port };
  }
  function decodeSSFullAuthority(raw, defaultPort) {
    const decAll = decodeBase64Url(raw || "");
    if (!decAll || !decAll.includes("@")) return null;
    const at = decAll.lastIndexOf("@");
    const cred = decAll.slice(0, at);
    const addr = decAll.slice(at + 1);
    let method = "", password = "";
    const i = cred.indexOf(":");
    if (i !== -1) {
      method = cred.slice(0, i);
      password = cred.slice(i + 1);
    }
    const ap = parseAddrHostPort(addr, defaultPort);
    return { method, password, host: ap.host, port: ap.port };
  }
  function validateBean(bean) {
    if (!bean || typeof bean !== "object") throw new Error("Incorrect link");
    const p = bean.proto;
    const requireHost = () => {
      if (!bean.host) throw new Error(p + ": missing host");
    };
    const requirePort = () => {
      if (!Number.isFinite(bean.port) || bean.port <= 0) throw new Error(p + ": invalid port");
    };
    const checkReserved = (val, label) => {
      if (val === void 0) return;
      if (typeof val === "string") {
        if (val.trim()) return;
      } else if (Array.isArray(val)) {
        const ok = val.length === 3 && val.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
        if (ok) return;
      }
      throw new Error(label + ": reserved must be 3 bytes or a non-empty base64 string");
    };
    const parsePortRangeItem = (item) => {
      const m = String(item || "").trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) return null;
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (a < 1 || a > 65535 || b < 1 || b > 65535 || a > b) return null;
      return { start: a, end: b };
    };
    const hasValidPortRange = (raw) => {
      const text = String(raw || "").trim();
      if (!text) return false;
      const items = text.split(",").map((x) => x.trim()).filter(Boolean);
      if (!items.length) return false;
      return items.every((x) => !!parsePortRangeItem(x));
    };
    switch (p) {
      case "mieru":
        requireHost();
        if (!Number.isFinite(bean.port) || bean.port <= 0) {
          if (!hasValidPortRange(bean.mieru?.server_ports)) {
            throw new Error("mieru: invalid port or port range");
          }
        }
        if (!bean.mieru?.username || !bean.mieru?.password) throw new Error("mieru: missing username/password");
        break;
      case "trusttunnel":
        requireHost();
        requirePort();
        if (!bean.trusttunnel?.username || !bean.trusttunnel?.password) throw new Error("trusttunnel: missing username/password");
        break;
      case "vless":
        requireHost();
        requirePort();
        if (!bean.auth?.uuid) throw new Error("vless missing UUID");
        break;
      case "vmess":
        requireHost();
        requirePort();
        if (!bean.auth?.uuid) throw new Error("vmess missing UUID");
        break;
      case "trojan":
        requireHost();
        requirePort();
        if (!bean.auth?.password) throw new Error("trojan: missing password");
        break;
      case "anytls":
        requireHost();
        requirePort();
        if (!bean.auth?.password) throw new Error("anytls: missing password");
        break;
      case "ss":
        requireHost();
        requirePort();
        if (!bean.ss?.method || !bean.ss?.password) throw new Error("shadowsocks: missing method/password");
        break;
      case "socks":
      case "http":
        requireHost();
        requirePort();
        break;
      case "hy2":
        requireHost();
        requirePort();
        if (!bean.auth?.password) throw new Error("hysteria2: missing password");
        break;
      case "tuic":
        requireHost();
        requirePort();
        {
          const hasToken = !!(bean.tuic && bean.tuic.token);
          if (!hasToken) {
            if (!bean.auth?.uuid || !isValidUuid(bean.auth.uuid)) throw new Error("tuic: invalid UUID");
            if (!bean.auth?.password) throw new Error("tuic: missing password");
          }
        }
        break;
      case "sdns":
        if (!bean.sdns?.stamp) throw new Error("sdns: missing stamp");
        break;
      case "wireguard": {
        requireHost();
        requirePort();
        const wg = bean.wireguard || {};
        if (!wg.privateKey) throw new Error("wireguard: missing PrivateKey");
        if (!wg.ip && !wg.ipv6) throw new Error("wireguard: missing Address");
        const peers = Array.isArray(wg.peers) ? wg.peers : [];
        const hasPeers = peers.length > 0;
        if (hasPeers) {
          for (let i = 0; i < peers.length; i++) {
            const peer = peers[i] || {};
            if (!peer.server) throw new Error(`wireguard: peers[${i}]: missing server`);
            if (!Number.isFinite(peer.port) || peer.port <= 0) throw new Error(`wireguard: peers[${i}]: invalid port`);
            if (!peer.publicKey) throw new Error(`wireguard: peers[${i}]: missing PublicKey`);
            if (!Array.isArray(peer.allowedIPs) || peer.allowedIPs.length === 0) throw new Error(`wireguard: peers[${i}]: missing AllowedIPs`);
            checkReserved(peer.reserved, `wireguard: peers[${i}]`);
          }
        } else {
          if (!wg.publicKey) throw new Error("wireguard: missing PublicKey");
          if (!Array.isArray(wg.allowedIPs) || wg.allowedIPs.length === 0) throw new Error("wireguard: missing AllowedIPs");
          checkReserved(wg.reserved, "wireguard");
        }
        break;
      }
      case "masque": {
        requireHost();
        requirePort();
        const mq = bean.masque || {};
        if (!mq.privateKey) throw new Error("masque: missing private-key");
        if (!mq.publicKey) throw new Error("masque: missing public-key");
        if (!mq.ip && !mq.ipv6) throw new Error("masque: missing ip/ipv6");
        break;
      }
      default:
        throw new Error("Unknown protocol: " + p);
    }
    if (bean.stream && bean.stream.reality && typeof bean.stream.reality.sid === "string") {
      const sidTrimmed = bean.stream.reality.sid.trim();
      if (sidTrimmed && sidTrimmed.length > 16) {
        throw new Error("REALITY shortId is too long (max 16 hex characters)");
      }
    }
  }
  function normalizeStream(stream, serverAddress) {
    if (!stream) return stream;
    if (stream.security === "none" || stream.security === "0" || stream.security === "false") {
      stream.security = "";
    } else if (stream.security === "1" || stream.security === "true") {
      stream.security = "tls";
    }
    if (stream.security === "tls" && stream.host && !stream.sni) {
      const isIp = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-fA-F:]+\]?$/.test(serverAddress || "");
      if (isIp) {
        stream.sni = stream.host;
      }
    }
    return stream;
  }
  function parseTunSpec(tunSpec) {
    return (tunSpec || "").split(",").map((s) => s.trim()).filter(Boolean).map((raw) => {
      const [namePart, modePart] = raw.split(":");
      const name = (namePart || "").trim();
      const m = (modePart || "").trim().toLowerCase();
      const mode = m === "auto" || m === "select" ? m : "select";
      return { name, mode };
    }).filter((x) => x.name);
  }
  function getUrlTestChoice(input) {
    const candidate = String(input || "").trim();
    if (!candidate) return URLTEST_CHOICES[0];
    const found = URLTEST_CHOICES.find((choice) => choice && choice.url === candidate);
    if (found) return found;
    if (isHttpUrl(candidate)) {
      return {
        id: "custom",
        label: candidate.replace(/^https?:\/\//i, ""),
        url: candidate,
        logo: "",
        expectedStatus: candidate.includes("generate_204") ? 204 : 200
      };
    }
    return URLTEST_CHOICES[0];
  }
  function resolveUrlTest(input) {
    return getUrlTestChoice(input).url;
  }
  function resolveUrlTestExpectedStatus(input) {
    return getUrlTestChoice(input).expectedStatus || 204;
  }
  function parseLink(input) {
    const trimmed = input.trim();
    const scheme = trimmed.split(":", 1)[0].toLowerCase();
    if (scheme === "tt") return parseTrustTunnel(trimmed);
    if (scheme === "mieru" || scheme === "mierus") return parseMieru(trimmed);
    if (scheme === "vmess") return parseVMess(trimmed);
    if (scheme === "vless") return parseVLESS(trimmed);
    if (scheme === "trojan") return parseTrojan(trimmed);
    if (scheme === "anytls") return parseAnyTLS(trimmed);
    if (scheme === "ss") return parseSS(trimmed);
    if (scheme.startsWith("socks")) return parseSocksHttp(trimmed);
    if (scheme === "http" || scheme === "https") return parseSocksHttp(trimmed);
    if (scheme === "hy2" || scheme === "hysteria2") return parseHysteria2(trimmed);
    if (scheme === "tuic") return parseTUIC(trimmed);
    if (scheme === "sdns") return parseSDNS(trimmed);
    if (scheme === "masque") return parseMasque(trimmed);
    throw new Error("Unknown link: " + scheme);
  }
  function parseMasque(urlStr) {
    const u = parseUrl(urlStr);
    if (u.protocol !== "masque:") throw new Error("A masque:// link is required");
    const q = getQuery(u);
    const name = safeDecodeURIComponent(u.hash.replace("#", ""));
    const getBool = (key) => {
      const raw = (q.get(key) || "").toString().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes";
    };
    const dnsRaw = q.get("dns") || "";
    const dns = dnsRaw ? dnsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    return {
      proto: "masque",
      host: u.hostname,
      port: asInt(u.port, 443),
      name,
      masque: {
        privateKey: (q.get("private-key") || "").trim(),
        publicKey: (q.get("public-key") || "").trim(),
        ip: (q.get("ip") || "").trim(),
        ipv6: (q.get("ipv6") || "").trim(),
        uri: (q.get("uri") || "").trim(),
        sni: (q.get("sni") || "").trim(),
        network: (q.get("network") || "").trim().toLowerCase(),
        mtu: asInt(q.get("mtu"), 0),
        udp: getBool("udp"),
        congestionController: (q.get("congestion-controller") || "").trim(),
        bbrProfile: (q.get("bbr-profile") || q.get("bbr_profile") || "").trim(),
        cwnd: asInt(q.get("cwnd"), 0),
        remoteDnsResolve: getBool("remote-dns-resolve"),
        dns
      }
    };
  }
  function parseSocksHttp(urlStr) {
    const u = parseUrl(urlStr);
    const query = getQuery(u);
    const isHttps = u.protocol === "https:";
    const isHttp = u.protocol === "http:";
    const isSocks4 = u.protocol.startsWith("socks4");
    let effectiveSecurity = (query.get("security") || "").toLowerCase();
    if (!effectiveSecurity) {
      if (isHttps) effectiveSecurity = "tls";
      else if (isHttp) effectiveSecurity = "";
      else effectiveSecurity = "";
    }
    const bean = {
      proto: isHttp || isHttps ? "http" : "socks",
      host: u.hostname,
      port: asInt(u.port, isHttps ? 443 : isHttp ? 80 : 1080),
      name: safeDecodeURIComponent(u.hash.replace("#", "")),
      socks: {
        type: isHttp || isHttps ? "http" : isSocks4 ? "socks4" : "socks5",
        username: safeDecodeURIComponent(u.username || ""),
        password: safeDecodeURIComponent(u.password || "")
      },
      stream: {
        network: "tcp",
        security: effectiveSecurity.replace("reality", "tls").replace("none", ""),
        sni: query.get("sni") || "",
        alpn: [],
        allowInsecure: false,
        fp: "",
        headerType: "",
        host: "",
        path: "",
        packet_encoding: ""
      }
    };
    if (!bean.socks.password && bean.socks.username) {
      const n = decodeBase64Url(bean.socks.username);
      if (n.includes(":")) {
        const [user, pass] = n.split(":");
        bean.socks.username = user;
        bean.socks.password = pass;
      }
    }
    return bean;
  }
  function parseTrojan(urlStr) {
    const u = parseUrl(urlStr);
    const q = getQuery(u);
    const bean = {
      proto: "trojan",
      host: u.hostname,
      port: asInt(u.port, 443),
      name: safeDecodeURIComponent(u.hash.replace("#", "")),
      auth: { password: safeDecodeURIComponent(u.username || "") },
      stream: buildStreamFromQuery(q, true),
      udp: q.get("udp") === "1" || q.get("udp") === "true",
      udpOverTcp: q.get("udp-over-tcp") === "1" || q.get("udp-over-tcp") === "true",
      ipVersion: q.get("ip-version") || ""
    };
    bean.stream = normalizeStream(bean.stream, bean.host);
    return bean;
  }
  function parseAnyTLS(urlStr) {
    const u = parseUrl(urlStr);
    if (u.protocol !== "anytls:") throw new Error("A anytls:// link is required");
    const q = getQuery(u);
    const pwd = safeDecodeURIComponent(u.username || "").trim() || (q.get("password") || "").trim();
    const bean = {
      proto: "anytls",
      host: u.hostname,
      port: asInt(u.port, 443),
      name: safeDecodeURIComponent(u.hash.replace("#", "")),
      auth: { password: pwd },
      stream: buildStreamFromQuery(q, false),
      udp: q.get("udp") === "1" || q.get("udp") === "true",
      udpOverTcp: q.get("udp-over-tcp") === "1" || q.get("udp-over-tcp") === "true",
      ipVersion: q.get("ip-version") || ""
    };
    if (!bean.stream || typeof bean.stream !== "object") bean.stream = {};
    bean.stream.network = "tcp";
    bean.stream.headerType = "";
    bean.stream.host = "";
    bean.stream.path = "";
    bean.stream.authority = "";
    bean.stream.security = "tls";
    bean.stream = normalizeStream(bean.stream, bean.host);
    return bean;
  }
  function parseVLESS(urlStr) {
    const u = parseUrl(urlStr);
    if (u.protocol !== "vless:") throw new Error("A vless:// link is required");
    const q = getQuery(u);
    const rawAfterScheme = urlStr.slice("vless://".length);
    const rawAuthority = rawAfterScheme.split(/[?#]/)[0];
    let host = u.hostname;
    let port = asInt(u.port, 443);
    const rawUser = safeDecodeURIComponent(u.username || "").trim();
    let uuid = rawUser;
    if (!isValidUuid(uuid) && rawUser) {
      const dec = decodeBase64Url(rawUser);
      if (dec) {
        const at = dec.lastIndexOf("@");
        if (at !== -1) {
          const cred = dec.slice(0, at);
          const addr = dec.slice(at + 1);
          const token = findUuidToken(cred);
          if (token) uuid = token;
          const ap = parseAddrHostPort(addr, port);
          if (ap.host) host = ap.host;
          if (ap.port) port = ap.port;
        } else {
          const token2 = findUuidToken(dec);
          if (token2) uuid = token2;
        }
      }
    }
    if (!uuid) {
      const pwd = safeDecodeURIComponent(u.password || "").trim();
      if (isValidUuid(pwd)) uuid = pwd;
    }
    if (!uuid) {
      const qp = (q.get("id") || q.get("uuid") || q.get("u") || "").trim();
      if (isValidUuid(qp)) uuid = qp;
    }
    if (!uuid && rawAuthority && !rawAuthority.includes("@")) {
      const r = decodeAuthorityAndExtract(rawAuthority, port);
      if (r) {
        if (r.uuid) uuid = r.uuid;
        if (r.host) host = r.host;
        if (r.port) port = r.port;
      }
    }
    if (!uuid) {
      const r2 = decodeAuthorityAndExtract(host, port);
      if (r2) {
        if (r2.uuid) uuid = r2.uuid;
        if (r2.host) host = r2.host;
        if (r2.port) port = r2.port;
      }
    }
    const bean = {
      proto: "vless",
      host,
      port,
      name: safeDecodeURIComponent(u.hash.replace("#", "")),
      auth: {
        uuid,
        flow: (q.get("flow") || "").replace(/-udp443$/, "").replace(/^none$/, ""),
        encryption: (q.get("encryption") || "").trim() || "none"
      },
      stream: buildStreamFromQuery(q, false),
      udp: q.get("udp") === "1" || q.get("udp") === "true",
      udpOverTcp: q.get("udp-over-tcp") === "1" || q.get("udp-over-tcp") === "true",
      ipVersion: q.get("ip-version") || ""
    };
    bean.stream = normalizeStream(bean.stream, bean.host);
    return bean;
  }
  function parseVMess(urlStr) {
    const payloadRaw = urlStr.slice("vmess://".length);
    let payload = (payloadRaw || "").split("#")[0].split("?")[0];
    const tryDecode = (s) => {
      const decoded = decodeBase64Url(s || "");
      const obj2 = decoded ? tryJSON(decoded) : null;
      return obj2;
    };
    const candidates = [];
    const push = (x) => {
      const v = String(x || "");
      if (!v) return;
      if (!candidates.includes(v)) candidates.push(v);
    };
    push(payload);
    push(takeBase64Prefix(payload));
    let obj = null;
    for (let i = 0; i < candidates.length && !obj; i++) {
      const cand = candidates[i];
      obj = tryDecode(cand);
      if (obj) break;
      const lastEq = cand.lastIndexOf("=");
      if (lastEq !== -1 && lastEq < cand.length - 1) {
        push(cand.slice(0, lastEq + 1));
      }
      for (let cut = cand.lastIndexOf("/"); cut > 0; cut = cand.lastIndexOf("/", cut - 1)) {
        push(cand.slice(0, cut));
      }
    }
    if (obj) {
      const net = (obj.net || "").toLowerCase();
      const type = net || "tcp";
      const stream = {
        network: type,
        security: (obj.tls || "").replace("reality", "tls") || (obj.security || ""),
        sni: obj.sni || "",
        host: obj.host || "",
        path: obj.path || "",
        headerType: obj.type || "",
        alpn: splitCSV(obj.alpn || ""),
        allowInsecure: false,
        fp: obj.fp || "",
        packet_encoding: obj.pac_enc || "",
        reality: { pbk: obj.pbk || "", sid: obj.sid || "", spx: obj.spx || "" }
      };
      const bean2 = {
        proto: "vmess",
        host: obj.add || "localhost",
        port: asInt(obj.port, 443),
        name: obj.ps || "",
        auth: { uuid: obj.id, security: obj.scy || "auto" },
        stream,
        udp: obj.udp === true || obj.udp === 1,
        udpOverTcp: obj["udp-over-tcp"] === true,
        ipVersion: obj["ip-version"] || ""
      };
      bean2.stream = normalizeStream(bean2.stream, bean2.host);
      return bean2;
    }
    const u = parseUrl(urlStr);
    const q = getQuery(u);
    const bean = {
      proto: "vmess",
      host: u.hostname,
      port: asInt(u.port, 443),
      name: safeDecodeURIComponent(u.hash.replace("#", "")),
      auth: { uuid: safeDecodeURIComponent(u.username || ""), security: q.get("encryption") || "auto" },
      stream: buildStreamFromQuery(q, false),
      udp: q.get("udp") === "1" || q.get("udp") === "true",
      udpOverTcp: q.get("udp-over-tcp") === "1" || q.get("udp-over-tcp") === "true",
      ipVersion: q.get("ip-version") || ""
    };
    bean.stream = normalizeStream(bean.stream, bean.host);
    return bean;
  }
  function parseSS(urlStr) {
    const u = parseUrl(urlStr);
    const name = safeDecodeURIComponent(u.hash.replace("#", ""));
    let method = u.username, password = u.password;
    let host = u.hostname;
    let port = asInt(u.port, 0);
    if (!password && u.username) {
      const dec = decodeBase64Url(u.username);
      if (dec.includes(":")) {
        const i = dec.indexOf(":"), b = dec.slice(i + 1);
        method = dec.slice(0, i);
        password = b;
      }
    }
    if (!host || !port || !method && !password) {
      const after = urlStr.slice("ss://".length);
      const raw = after.split(/[?#]/)[0];
      const full = decodeSSFullAuthority(raw, port || 0);
      if (full) {
        host = full.host;
        port = full.port;
        if (!method) method = full.method;
        if (!password) password = full.password;
      }
    }
    const q = getQuery(u);
    const parseUotVersion = () => {
      const raw = (q.get("udp-over-tcp-version") || q.get("uotVersion") || q.get("uot") || "").toString().trim().toLowerCase();
      if (!raw) return 0;
      if (raw === "true" || raw === "yes" || raw === "on") return 2;
      if (raw === "1") return 2;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const uotVersion = parseUotVersion();
    let plugin = q.get("plugin") || "";
    const pluginOpts = {};
    if (plugin && plugin.includes(";")) {
      const parts = plugin.split(";");
      plugin = parts[0].trim();
      for (let i = 1; i < parts.length; i++) {
        const raw = parts[i] || "";
        if (!raw.trim()) continue;
        const eq = raw.indexOf("=");
        if (eq === -1) {
          const key = raw.trim();
          if (key) pluginOpts[key] = true;
        } else {
          const key = raw.slice(0, eq).trim();
          const val = raw.slice(eq + 1).trim();
          if (key && val) pluginOpts[key] = val;
        }
      }
    } else if (plugin) {
      const mode = q.get("obfs") || q.get("mode") || "";
      const obfsHost = q.get("obfs-host") || q.get("host") || "";
      const obfsPath = q.get("obfs-path") || q.get("path") || "";
      const tls = q.get("tls") === "true" || q.get("tls") === "1";
      if (mode) pluginOpts.mode = mode;
      if (obfsHost) pluginOpts.host = obfsHost;
      if (obfsPath) pluginOpts.path = obfsPath;
      if (tls) pluginOpts.tls = true;
      if (plugin === "shadow-tls" || plugin.includes("shadow-tls")) {
        const stPassword = q.get("password") || q.get("shadow-tls-password") || "";
        const version = q.get("version") || q.get("shadow-tls-version") || "3";
        if (stPassword) pluginOpts.password = stPassword;
        if (version) pluginOpts.version = parseInt(version, 10);
      }
    }
    const smux = {};
    const smuxEnabled = q.get("smux") === "1" || q.get("smux") === "true";
    if (smuxEnabled) {
      smux.enabled = true;
      smux.protocol = q.get("smux-protocol") || "smux";
      const maxStreams = q.get("smux-max-streams");
      if (maxStreams) smux["max-streams"] = parseInt(maxStreams, 10);
    }
    return {
      proto: "ss",
      host,
      port,
      name,
      ss: {
        method,
        password,
        uot: uotVersion,
        plugin,
        pluginOpts: Object.keys(pluginOpts).length ? pluginOpts : "",
        smux: smuxEnabled ? smux : null
      },
      stream: { network: "tcp", security: "" },
      udp: q.get("udp") === "1" || q.get("udp") === "true",
      udpOverTcp: q.get("udp-over-tcp") === "1" || q.get("udp-over-tcp") === "true"
    };
  }
  function parseHysteria2(urlStr) {
    const u = parseUrl(urlStr);
    const q = getQuery(u);
    const pwd = u.password ? safeDecodeURIComponent(u.username || "") + ":" + safeDecodeURIComponent(u.password) : safeDecodeURIComponent(u.username || "");
    const tlsExtras = parseTlsQueryExtras(q);
    const qParams = tryJSON(q.get("quicParams") || q.get("quic_params") || "") || {};
    const fmTcp = tryJSON(q.get("finalmask_tcp") || q.get("finalmask-tcp") || "") || [];
    const fmUdp = tryJSON(q.get("finalmask_udp") || q.get("finalmask-udp") || "") || [];
    const hy2Finalmask = {};
    if (Array.isArray(fmTcp) && fmTcp.length) hy2Finalmask.tcp = fmTcp;
    if (Array.isArray(fmUdp) && fmUdp.length) hy2Finalmask.udp = fmUdp;
    const hy2QuicParams = qParams && typeof qParams === "object" ? { ...qParams } : {};
    const congestion = (q.get("congestion") || "").trim().toLowerCase();
    const brutalUp = (q.get("brutal_up") || q.get("brutalUp") || q.get("up") || "").trim();
    const brutalDown = (q.get("brutal_down") || q.get("brutalDown") || q.get("down") || "").trim();
    const hopPort = (q.get("mport") || "").trim();
    const hopIntervalRaw = (q.get("hop_interval") || "").trim();
    let hopIntervalValue = null;
    if (hopIntervalRaw) {
      const m = hopIntervalRaw.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m && m[1] && m[2]) {
        hopIntervalValue = `${m[1]}-${m[2]}`;
      } else if (/^\d+$/.test(hopIntervalRaw)) {
        hopIntervalValue = asInt(hopIntervalRaw, 0);
      }
    }
    if (congestion && !hy2QuicParams.congestion) hy2QuicParams.congestion = congestion;
    if (brutalUp && !hy2QuicParams.brutalUp) hy2QuicParams.brutalUp = brutalUp;
    if (brutalDown && !hy2QuicParams.brutalDown) hy2QuicParams.brutalDown = brutalDown;
    if (hopPort || hopIntervalValue !== null) {
      if (!hy2QuicParams.udpHop || typeof hy2QuicParams.udpHop !== "object") hy2QuicParams.udpHop = {};
      if (hopPort && !hy2QuicParams.udpHop.ports) hy2QuicParams.udpHop.ports = hopPort;
      if (hopIntervalValue !== null && hy2QuicParams.udpHop.interval === void 0) {
        hy2QuicParams.udpHop.interval = hopIntervalValue;
      }
    }
    if (Object.keys(hy2QuicParams).length) hy2Finalmask.quicParams = hy2QuicParams;
    return {
      proto: "hy2",
      host: u.hostname,
      port: asInt(u.port, 443),
      name: safeDecodeURIComponent(u.hash.replace("#", "")),
      auth: { password: pwd },
      hysteria2: {
        obfsPassword: q.get("obfs-password") || "",
        hopPort: q.get("mport") || "",
        hopInterval: q.get("hop_interval") || "",
        bbrProfile: q.get("bbr-profile") || q.get("bbr_profile") || "",
        alpn: q.get("alpn") || "h3",
        sni: q.get("sni") || "",
        allowInsecure: ["1", "true", "yes"].includes((q.get("allowInsecure") || q.get("insecure") || "").toLowerCase()),
        pinnedPeerCertSha256: (q.get("pinnedPeerCertSha256") || q.get("pinned-peer-cert-sha256") || q.get("pinSHA256") || q.get("pin-sha256") || "").trim(),
        verifyPeerCertByName: (q.get("verifyPeerCertByName") || q.get("verify-peer-cert-by-name") || "").trim(),
        certificatePublicKeySha256: tlsExtras.certificatePublicKeySha256,
        ech: tlsExtras.ech,
        congestion: q.get("congestion") || "",
        brutalUp,
        brutalDown,
        finalmask: Object.keys(hy2Finalmask).length ? hy2Finalmask : null
      }
    };
  }
  function parseTUIC(urlStr) {
    const u = parseUrl(urlStr);
    const q = getQuery(u);
    const tlsExtras = parseTlsQueryExtras(q);
    return {
      proto: "tuic",
      host: u.hostname,
      port: asInt(u.port, 443),
      name: safeDecodeURIComponent(u.hash.replace("#", "")),
      auth: {
        uuid: safeDecodeURIComponent(u.username || ""),
        password: safeDecodeURIComponent(u.password || "")
      },
      tuic: {
        congestion_control: q.get("congestion_control") || "bbr",
        bbr_profile: q.get("bbr-profile") || q.get("bbr_profile") || "",
        udp_relay_mode: q.get("udp_relay_mode") || "native",
        zero_rtt_handshake: q.get("zero_rtt") === "1",
        udp_over_stream: q.get("udp_over_stream") === "1",
        heartbeat: q.get("heartbeat") || "",
        alpn: q.get("alpn") || "",
        sni: q.get("sni") || "",
        allowInsecure: ["1", "true", "yes"].includes((q.get("allow_insecure") || q.get("allowInsecure") || q.get("insecure") || "").toLowerCase()),
        disableSni: ["1", "true", "yes"].includes((q.get("disable_sni") || q.get("disableSni") || "").toLowerCase()),
        token: q.get("token") || "",
        requestTimeout: q.get("request_timeout") || q.get("request-timeout") || "",
        reduceRtt: ["1", "true"].includes((q.get("reduce_rtt") || q.get("reduce-rtt") || "").toLowerCase()),
        certificatePublicKeySha256: tlsExtras.certificatePublicKeySha256,
        ech: tlsExtras.ech
      }
    };
  }
  function parseMieru(urlStr) {
    const u = parseUrl(urlStr);
    if (u.protocol !== "mieru:" && u.protocol !== "mierus:") throw new Error("A mieru:// or mierus:// link is required");
    const q = getQuery(u);
    const isLikelyStandardShare = (() => {
      const raw = String(urlStr || "").trim();
      const isMieruScheme = raw.toLowerCase().startsWith("mieru://");
      const isMierusScheme = raw.toLowerCase().startsWith("mierus://");
      if (!isMieruScheme && !isMierusScheme) return false;
      if ((u.username || "").trim() || (u.password || "").trim()) return false;
      const queryText = q && typeof q.toString === "function" ? q.toString() : "";
      if (queryText.trim()) return false;
      const offset = isMierusScheme ? "mierus://".length : "mieru://".length;
      const payload = raw.slice(offset).split("#", 1)[0].trim();
      return /^[A-Za-z0-9+/=_-]+$/.test(payload) && payload.length > 20;
    })();
    if (isLikelyStandardShare) {
      throw new Error("mieru: standard base64 share link is not supported yet");
    }
    const extractRangeFromAuthority = (raw) => {
      const src = String(raw || "").trim();
      if (!src) return "";
      const noHash = src.split("#", 1)[0] || "";
      const noQuery = noHash.split("?", 1)[0] || "";
      const schemePos = noQuery.indexOf("://");
      const authority = schemePos >= 0 ? noQuery.slice(schemePos + 3) : noQuery;
      const hostPort = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
      const m = hostPort.match(/:(\d+\s*-\s*\d+)$/);
      if (!m) return "";
      return m[1].replace(/\s+/g, "");
    };
    const getAllQueryValues = (key) => {
      if (q && typeof q.getAll === "function") {
        const values = q.getAll(key);
        if (Array.isArray(values)) return values.map((v) => String(v || "").trim()).filter(Boolean);
      }
      const raw = String(urlStr || "");
      const queryPart = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1).split("#", 1)[0] : "";
      if (!queryPart) return [];
      try {
        const sp = new URLSearchParams(queryPart);
        return sp.getAll(key).map((v) => String(v || "").trim()).filter(Boolean);
      } catch {
        return [];
      }
    };
    const username = safeDecodeURIComponent(u.username || "");
    const password = safeDecodeURIComponent(u.password || "");
    const name = safeDecodeURIComponent(u.hash.replace("#", ""));
    const repeatedPorts = getAllQueryValues("port");
    let serverPorts = q.get("server_ports") || q.get("ports") || q.get("portRange") || q.get("port_range") || "";
    if (!serverPorts && repeatedPorts.length) serverPorts = repeatedPorts.join(",");
    if (!serverPorts) serverPorts = extractRangeFromAuthority(urlStr);
    const protocolItems = getAllQueryValues("protocol").map((x) => x.toUpperCase());
    const transport = (q.get("transport") || q.get("protocol") || protocolItems[0] || "TCP").toUpperCase();
    const multiplexing = (q.get("multiplexing") || "").toUpperCase();
    const handshakeMode = (q.get("handshake_mode") || q.get("handshake-mode") || "").toUpperCase();
    const trafficPattern = (q.get("traffic_pattern") || q.get("traffic-pattern") || "").trim();
    let fallbackPort = 0;
    if (serverPorts) {
      const m = String(serverPorts).match(/^(\d+)/);
      if (m) fallbackPort = asInt(m[1], fallbackPort);
    }
    return {
      proto: "mieru",
      host: u.hostname,
      port: asInt(u.port, fallbackPort),
      name,
      mieru: {
        username,
        password,
        server_ports: serverPorts,
        transport,
        multiplexing,
        handshake_mode: handshakeMode,
        traffic_pattern: trafficPattern
      }
    };
  }
  function parseTrustTunnel(urlStr) {
    const raw = String(urlStr || "").trim();
    if (!raw.toLowerCase().startsWith("tt://?")) throw new Error("A tt://? link is required");
    const hashIndex = raw.indexOf("#");
    const payloadPlus = raw.slice("tt://?".length, hashIndex === -1 ? void 0 : hashIndex).trim();
    const ampIndex = payloadPlus.indexOf("&");
    const payload = (ampIndex === -1 ? payloadPlus : payloadPlus.slice(0, ampIndex)).trim();
    const extraQuery = ampIndex === -1 ? "" : payloadPlus.slice(ampIndex + 1);
    const extraParams = new URLSearchParams(extraQuery);
    if (!payload) throw new Error("tt: missing payload");
    const decoded = decodeBase64Url(payload);
    if (!decoded) throw new Error("tt: invalid base64 payload");
    const fields = /* @__PURE__ */ new Map();
    const addresses = [];
    for (let i = 0; i < decoded.length; ) {
      const tagInfo = readTlsVarIntBinary(decoded, i);
      const lenInfo = readTlsVarIntBinary(decoded, tagInfo.nextOffset);
      const valueStart = lenInfo.nextOffset;
      const valueEnd = valueStart + lenInfo.value;
      if (valueEnd > decoded.length) throw new Error("tt: truncated field value");
      const value = decoded.slice(valueStart, valueEnd);
      if (tagInfo.value === 2) addresses.push(value);
      else fields.set(tagInfo.value, value);
      i = valueEnd;
    }
    const versionRaw = fields.get(0);
    if (versionRaw && versionRaw.length) {
      const version = versionRaw.charCodeAt(0);
      if (version !== 0) throw new Error("tt: unsupported version " + version);
    }
    const endpoint = addresses.find(Boolean) || "";
    const parsed = parseAddrHostPort(endpoint, 443);
    const hostname = fields.get(1) || "";
    const customSni = fields.get(3) || "";
    const skipVerification = (fields.get(7) || "").charCodeAt(0) === 1;
    const upstreamProtocol = (fields.get(9) || "").charCodeAt(0);
    const sni = customSni || hostname || parsed.host || "";
    const name = hashIndex === -1 ? "" : safeDecodeURIComponent(raw.slice(hashIndex + 1));
    if (!hostname) throw new Error("tt: missing hostname");
    if (!endpoint) throw new Error("tt: missing address");
    if (!fields.get(5)) throw new Error("tt: missing username");
    if (!fields.get(6)) throw new Error("tt: missing password");
    const bean = {
      proto: "trusttunnel",
      host: parsed.host,
      port: parsed.port,
      name,
      trusttunnel: {
        username: fields.get(5) || "",
        password: fields.get(6) || "",
        healthCheck: false,
        quic: false,
        congestionController: "",
        cwnd: 0,
        maxConnections: 0,
        minStreams: 0,
        maxStreams: 0,
        fingerprint: "",
        certificate: "",
        privateKey: ""
      },
      stream: {
        network: "tcp",
        security: "tls",
        sni,
        alpn: [],
        allowInsecure: skipVerification,
        ech: {
          config: "",
          queryServerName: ""
        },
        fp: ""
      },
      udp: false,
      udpOverTcp: false,
      ipVersion: ""
    };
    if (upstreamProtocol === 1) bean.stream.alpn = ["h2"];
    if (upstreamProtocol === 2) {
      bean.stream.alpn = ["h3"];
      bean.trusttunnel.quic = true;
    }
    const tt = bean.trusttunnel;
    const qQuic = (extraParams.get("quic") || "").toLowerCase();
    if (["1", "true", "yes"].includes(qQuic)) tt.quic = true;
    const qHealth = (extraParams.get("health-check") || extraParams.get("health_check") || "").toLowerCase();
    if (["1", "true", "yes"].includes(qHealth)) tt.healthCheck = true;
    const qCc = (extraParams.get("congestion-controller") || extraParams.get("congestion_controller") || "").trim();
    if (qCc) tt.congestionController = qCc;
    const qBbrProfile = (extraParams.get("bbr-profile") || extraParams.get("bbr_profile") || "").trim();
    if (qBbrProfile) tt.bbrProfile = qBbrProfile;
    const qCwnd = asInt(extraParams.get("cwnd"), 0);
    if (qCwnd > 0) tt.cwnd = qCwnd;
    const qMaxConn = asInt(extraParams.get("max-connections") || extraParams.get("max_connections"), 0);
    if (qMaxConn > 0) tt.maxConnections = qMaxConn;
    const qMinStreams = asInt(extraParams.get("min-streams") || extraParams.get("min_streams"), 0);
    if (qMinStreams >= 0) tt.minStreams = qMinStreams;
    const qMaxStreams = asInt(extraParams.get("max-streams") || extraParams.get("max_streams"), 0);
    if (qMaxStreams >= 0) tt.maxStreams = qMaxStreams;
    bean.stream = normalizeStream(bean.stream, bean.host);
    return bean;
  }
  function parseMieruProfilesJson(jsonObj) {
    if (!jsonObj || typeof jsonObj !== "object") return [];
    const profiles = Array.isArray(jsonObj.profiles) ? jsonObj.profiles : jsonObj.profileName || jsonObj.user || jsonObj.servers ? [jsonObj] : [];
    if (!profiles.length) return [];
    const beans = [];
    for (const p of profiles) {
      const username = p?.user?.name || "";
      const password = p?.user?.password || "";
      const profileName = (p?.profileName || "").trim();
      const servers = Array.isArray(p?.servers) ? p.servers : [];
      const multiplexing = (() => {
        const mx = p?.multiplexing;
        if (typeof mx === "string") return mx.toUpperCase();
        if (mx && typeof mx === "object") {
          const level = (mx.level || mx.Level || "").toString().trim();
          return level ? level.toUpperCase() : "";
        }
        return "";
      })();
      const handshakeMode = (p?.handshakeMode || p?.handshake_mode || "").toString().toUpperCase();
      const trafficPattern = (() => {
        const tp = p?.trafficPattern ?? p?.traffic_pattern;
        if (typeof tp === "string") return tp.trim();
        return "";
      })();
      for (const s of servers) {
        const host = s?.ipAddress || s?.host || s?.hostname || "";
        const bindings = Array.isArray(s?.portBindings) ? s.portBindings : [];
        if (!host || !bindings.length) continue;
        for (const b of bindings) {
          const protocol = (b?.protocol || "TCP").toString().toUpperCase();
          const portRange = (b?.portRange || "").toString();
          const singlePort = asInt(b?.port, 0);
          let serverPort = singlePort > 0 ? singlePort : 0;
          if (portRange) {
            const m = portRange.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (m) {
              serverPort = asInt(m[1], serverPort);
            }
          }
          const bean = {
            proto: "mieru",
            host,
            port: serverPort,
            name: profileName || `mieru-${host}:${serverPort}`,
            mieru: {
              username,
              password,
              server_ports: portRange,
              transport: protocol,
              multiplexing,
              handshake_mode: handshakeMode,
              traffic_pattern: trafficPattern
            }
          };
          beans.push(bean);
        }
      }
    }
    return beans;
  }
  function parseSDNS(urlStr) {
    const u = parseUrl(urlStr);
    if (u.protocol !== "sdns:") throw new Error("A sdns:// link is required");
    const stamp = urlStr;
    const name = safeDecodeURIComponent(u.hash.replace("#", ""));
    return {
      proto: "sdns",
      host: u.hostname,
      port: asInt(u.port, 443),
      name: name || "sdns-server",
      sdns: {
        stamp
      }
    };
  }
  function buildBeansFromInput(raw) {
    const text = (raw || "").trim();
    if (!text) return [];
    if (text.startsWith("{") || text.startsWith("[")) {
      const obj = tryJSON(text);
      if (obj) {
        const fromProfiles = parseMieruProfilesJson(obj);
        if (fromProfiles.length) return fromProfiles;
        return [];
      }
    }
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return lines.map(parseLink);
  }
  function buildStreamFromQuery(q, isTrojan) {
    const parseIntOrRange = (raw) => {
      const t = String(raw || "").trim();
      if (!t) return "";
      if (/^\d+\s*-\s*\d+$/.test(t)) return t.replace(/\s+/g, "");
      const n = asInt(t, 0);
      return n > 0 ? n : "";
    };
    const toObject = (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      return raw;
    };
    const toIntValue = (raw) => {
      const n = asInt(String(raw ?? "").trim(), 0);
      return n > 0 ? n : 0;
    };
    const toStringValue = (raw) => {
      if (raw === void 0 || raw === null) return "";
      return String(raw).trim();
    };
    const mergeXmuxSettings = (target, source, prefix = "") => {
      const xmux = toObject(source);
      if (!xmux) return;
      const setInt = (srcKey, dstKey) => {
        const n = toIntValue(xmux[srcKey]);
        if (n > 0 && (target[dstKey] === "" || target[dstKey] === 0 || target[dstKey] === void 0 || target[dstKey] === null)) {
          target[dstKey] = n;
        }
      };
      setInt(prefix + "maxConnections", "max_connections");
      setInt(prefix + "maxConcurrency", "max_concurrency");
      setInt(prefix + "cMaxReuseTimes", "c_max_reuse_times");
      setInt(prefix + "hMaxRequestTimes", "h_max_request_times");
      setInt(prefix + "hMaxReusableSecs", "h_max_reusable_secs");
      setInt(prefix + "hKeepAlivePeriod", "h_keep_alive_period");
    };
    let type = (q.get("type") || "tcp").toLowerCase();
    const mode = (q.get("mode") || "").toLowerCase();
    if (mode === "gun") type = "grpc";
    if (type === "h2") type = "http";
    if (type === "w" || type === "websocket") type = "ws";
    if (type !== "xhttp" && (q.get("xhttp") === "1" || q.get("xhttp") === "true")) type = "xhttp";
    const security = (q.get("security") || (isTrojan ? "tls" : "")).toLowerCase().replace("reality", "tls").replace("none", "");
    const sni = q.get("sni") || q.get("peer") || "";
    const authority = q.get("authority") || "";
    const grpcUserAgent = q.get("grpc-user-agent") || "";
    const grpcPingInterval = asInt(q.get("ping-interval") || q.get("ping_interval"), 0);
    const grpcMaxConnections = asInt(q.get("grpc-max-connections") || q.get("grpc_max_connections"), 0);
    const grpcMinStreams = asInt(q.get("grpc-min-streams") || q.get("grpc_min_streams"), 0);
    const grpcMaxStreams = asInt(q.get("grpc-max-streams") || q.get("grpc_max_streams"), 0);
    const alpn = splitCSV(q.get("alpn") || "");
    const aiRaw = (q.get("allowInsecure") || q.get("insecure") || "").toLowerCase();
    const allowInsecure = ["1", "true", "yes"].includes(aiRaw);
    const pinnedPeerCertSha256 = (q.get("pinnedPeerCertSha256") || q.get("pinned-peer-cert-sha256") || q.get("pinSHA256") || q.get("pin-sha256") || "").trim();
    const verifyPeerCertByName = (q.get("verifyPeerCertByName") || q.get("verify-peer-cert-by-name") || "").trim();
    const { certificatePublicKeySha256, ech } = parseTlsQueryExtras(q);
    const fp = q.get("fp") || "";
    const packetEncoding = (q.get("packetEncoding") || q.get("packet_encoding") || "").trim();
    const reality = {
      pbk: q.get("pbk") || "",
      sid: (q.get("sid") || "").split(",")[0] || "",
      spx: q.get("spx") || "",
      pqv: q.get("pqv") || ""
    };
    const stream = {
      network: type,
      security,
      sni,
      authority,
      grpcUserAgent,
      grpcPingInterval,
      grpcMaxConnections,
      grpcMinStreams,
      grpcMaxStreams,
      alpn,
      allowInsecure,
      pinnedPeerCertSha256,
      verifyPeerCertByName,
      certificatePublicKeySha256,
      ech,
      fp,
      reality,
      headerType: "",
      host: "",
      path: "",
      packet_encoding: packetEncoding,
      xhttpMode: "",
      xhttpXmux: {},
      xhttpDownload: {}
    };
    if (type === "ws") {
      stream.path = q.get("path") || "";
      stream.host = q.get("host") || "";
      const ed = asInt((q.get("ed") || "").toString(), 0);
      if (ed > 0) {
        stream.wsEarlyData = { max_early_data: ed, early_data_header_name: "Sec-WebSocket-Protocol" };
      }
    } else if (type === "http") {
      stream.path = q.get("path") || "";
      stream.host = (q.get("host") || "").replace(/\|/g, ",");
    } else if (type === "xhttp") {
      stream.path = q.get("path") || "";
      stream.host = q.get("host") || "";
      stream.xhttpMode = q.get("xmode") || q.get("mode") || "";
      stream.xhttpXPaddingBytes = q.get("x_padding_bytes") || q.get("x-padding-bytes") || "";
      stream.xhttpXmux = {
        max_concurrency: q.get("xmux_max_concurrency") || q.get("reuse_max_concurrency") || "",
        max_connections: q.get("xmux_max_connections") || q.get("reuse_max_connections") || "",
        c_max_reuse_times: q.get("xmux_c_max_reuse_times") || q.get("reuse_c_max_reuse_times") || "",
        h_max_request_times: q.get("xmux_h_max_request_times") || q.get("reuse_h_max_request_times") || "",
        h_max_reusable_secs: q.get("xmux_h_max_reusable_secs") || q.get("reuse_h_max_reusable_secs") || "",
        h_keep_alive_period: asInt(q.get("xmux_h_keep_alive_period"), 0)
      };
      stream.xhttpScMaxEachPostBytes = parseIntOrRange(q.get("sc-max-each-post-bytes") || q.get("sc_max_each_post_bytes"));
      stream.xhttpScMaxBufferedPosts = asInt(q.get("sc-max-buffered-posts") || q.get("sc_max_buffered_posts"), 0);
      stream.xhttpScMinPostsIntervalMs = parseIntOrRange(q.get("sc-min-posts-interval-ms") || q.get("sc_min_posts_interval_ms"));
      stream.xhttpScStreamUpServerSecs = parseIntOrRange(q.get("sc-stream-up-server-secs") || q.get("sc_stream_up_server_secs"));
      stream.xhttpNoSseHeader = (q.get("no_sse_header") || "").toLowerCase() === "true" || q.get("no_sse_header") === "1";
      stream.xhttpServerMaxHeaderBytes = asInt(q.get("server_max_header_bytes") || q.get("server-max-header-bytes"), 0);
      stream.xhttpDownload = {
        mode: q.get("download_mode") || "",
        host: q.get("download_host") || "",
        path: q.get("download_path") || "",
        x_padding_bytes: q.get("download_x_padding_bytes") || "",
        sc_max_each_post_bytes: q.get("download_sc_max_each_post_bytes") || "",
        sc_min_posts_interval_ms: q.get("download_sc_min_posts_interval_ms") || "",
        sc_stream_up_server_secs: q.get("download_sc_stream_up_server_secs") || "",
        sc_max_buffered_posts: asInt(q.get("download_sc_max_buffered_posts"), 0),
        server_max_header_bytes: asInt(q.get("download_server_max_header_bytes"), 0),
        no_sse_header: q.get("download_no_sse_header") || "",
        server: q.get("download_server") || "",
        server_port: asInt(q.get("download_server_port"), 0),
        security: (q.get("download_security") || "").toLowerCase(),
        servername: q.get("download_servername") || q.get("download_sni") || "",
        client_fingerprint: q.get("download_client_fingerprint") || q.get("download_fp") || "",
        skip_cert_verify: (q.get("download_skip_cert_verify") || "").toLowerCase() === "true" || q.get("download_skip_cert_verify") === "1",
        alpn: splitCSV(q.get("download_alpn") || ""),
        reality: {
          public_key: q.get("download_pbk") || "",
          short_id: (q.get("download_sid") || "").split(",")[0] || ""
        },
        detour: q.get("download_detour") || "",
        xmux: {
          max_concurrency: q.get("download_xmux_max_concurrency") || q.get("download_reuse_max_concurrency") || "",
          max_connections: q.get("download_xmux_max_connections") || q.get("download_reuse_max_connections") || "",
          c_max_reuse_times: q.get("download_xmux_c_max_reuse_times") || q.get("download_reuse_c_max_reuse_times") || "",
          h_max_request_times: q.get("download_xmux_h_max_request_times") || q.get("download_reuse_h_max_request_times") || "",
          h_max_reusable_secs: q.get("download_xmux_h_max_reusable_secs") || q.get("download_reuse_h_max_reusable_secs") || "",
          h_keep_alive_period: asInt(q.get("download_xmux_h_keep_alive_period") || q.get("download_reuse_h_keep_alive_period"), 0)
        }
      };
      const xhttpExtra = toObject(tryJSON(q.get("extra") || ""));
      if (xhttpExtra) {
        if (!stream.xhttpXPaddingBytes) {
          const xPaddingBytes = toStringValue(xhttpExtra.xPaddingBytes);
          if (xPaddingBytes) stream.xhttpXPaddingBytes = xPaddingBytes;
        }
        if (xhttpExtra.noGRPCHeader === true) stream.xhttpNoGrpcHeader = true;
        if (typeof xhttpExtra.xPaddingObfsMode === "boolean") stream.xhttpXPaddingObfsMode = xhttpExtra.xPaddingObfsMode;
        const xPaddingKey = toStringValue(xhttpExtra.xPaddingKey);
        if (xPaddingKey) stream.xhttpXPaddingKey = xPaddingKey;
        const xPaddingHeader = toStringValue(xhttpExtra.xPaddingHeader);
        if (xPaddingHeader) stream.xhttpXPaddingHeader = xPaddingHeader;
        const xPaddingPlacement = toStringValue(xhttpExtra.xPaddingPlacement);
        if (xPaddingPlacement) stream.xhttpXPaddingPlacement = xPaddingPlacement;
        const xPaddingMethod = toStringValue(xhttpExtra.xPaddingMethod);
        if (xPaddingMethod) stream.xhttpXPaddingMethod = xPaddingMethod;
        const uplinkHttpMethod = toStringValue(xhttpExtra.uplinkHttpMethod);
        if (uplinkHttpMethod) stream.xhttpUplinkHttpMethod = uplinkHttpMethod;
        const sessionPlacement = toStringValue(xhttpExtra.sessionPlacement);
        if (sessionPlacement) stream.xhttpSessionPlacement = sessionPlacement;
        const sessionKey = toStringValue(xhttpExtra.sessionKey);
        if (sessionKey) stream.xhttpSessionKey = sessionKey;
        const seqPlacement = toStringValue(xhttpExtra.seqPlacement);
        if (seqPlacement) stream.xhttpSeqPlacement = seqPlacement;
        const seqKey = toStringValue(xhttpExtra.seqKey);
        if (seqKey) stream.xhttpSeqKey = seqKey;
        const uplinkDataPlacement = toStringValue(xhttpExtra.uplinkDataPlacement);
        if (uplinkDataPlacement) stream.xhttpUplinkDataPlacement = uplinkDataPlacement;
        const uplinkDataKey = toStringValue(xhttpExtra.uplinkDataKey);
        if (uplinkDataKey) stream.xhttpUplinkDataKey = uplinkDataKey;
        const uplinkChunkSize = toIntValue(xhttpExtra.uplinkChunkSize);
        if (uplinkChunkSize > 0) stream.xhttpUplinkChunkSize = uplinkChunkSize;
        if (!stream.xhttpScMaxEachPostBytes) {
          const scMaxEachPostBytes = parseIntOrRange(xhttpExtra.scMaxEachPostBytes);
          if (scMaxEachPostBytes !== "") stream.xhttpScMaxEachPostBytes = scMaxEachPostBytes;
        }
        if (!stream.xhttpScMinPostsIntervalMs) {
          const scMinPostsIntervalMs = parseIntOrRange(xhttpExtra.scMinPostsIntervalMs);
          if (scMinPostsIntervalMs !== "") stream.xhttpScMinPostsIntervalMs = scMinPostsIntervalMs;
        }
        if (!stream.xhttpScStreamUpServerSecs) {
          const scStreamUpServerSecs = parseIntOrRange(xhttpExtra.scStreamUpServerSecs);
          if (scStreamUpServerSecs !== "") stream.xhttpScStreamUpServerSecs = scStreamUpServerSecs;
        }
        if (!stream.xhttpScMaxBufferedPosts) {
          const scMaxBufferedPosts = toIntValue(xhttpExtra.scMaxBufferedPosts);
          if (scMaxBufferedPosts > 0) stream.xhttpScMaxBufferedPosts = scMaxBufferedPosts;
        }
        if (!stream.xhttpServerMaxHeaderBytes) {
          const serverMaxHeaderBytes = toIntValue(xhttpExtra.serverMaxHeaderBytes);
          if (serverMaxHeaderBytes > 0) stream.xhttpServerMaxHeaderBytes = serverMaxHeaderBytes;
        }
        if (typeof xhttpExtra.noSSEHeader === "boolean") stream.xhttpNoSseHeader = xhttpExtra.noSSEHeader;
        mergeXmuxSettings(stream.xhttpXmux, xhttpExtra.xmux);
        const downloadSettings = toObject(xhttpExtra.downloadSettings);
        if (downloadSettings) {
          const downloadAddress = toStringValue(downloadSettings.address);
          if (downloadAddress && !stream.xhttpDownload.server) stream.xhttpDownload.server = downloadAddress;
          const downloadPort = toIntValue(downloadSettings.port);
          if (downloadPort > 0 && !stream.xhttpDownload.server_port) stream.xhttpDownload.server_port = downloadPort;
          const downloadSecurity = toStringValue(downloadSettings.security).toLowerCase();
          if (downloadSecurity && !stream.xhttpDownload.security) stream.xhttpDownload.security = downloadSecurity;
          const tlsSettings = toObject(downloadSettings.tlsSettings);
          if (tlsSettings) {
            const downloadServerName = toStringValue(tlsSettings.serverName);
            if (downloadServerName && !stream.xhttpDownload.servername) stream.xhttpDownload.servername = downloadServerName;
            const downloadFingerprint = toStringValue(tlsSettings.fingerprint);
            if (downloadFingerprint && !stream.xhttpDownload.client_fingerprint) stream.xhttpDownload.client_fingerprint = downloadFingerprint;
            if (tlsSettings.allowInsecure === true) stream.xhttpDownload.skip_cert_verify = true;
            if ((!stream.xhttpDownload.alpn || !stream.xhttpDownload.alpn.length) && Array.isArray(tlsSettings.alpn)) {
              stream.xhttpDownload.alpn = tlsSettings.alpn.filter((v) => typeof v === "string" && v.trim());
            }
          }
          const realitySettings = toObject(downloadSettings.realitySettings);
          if (realitySettings) {
            const downloadRealityPublicKey = toStringValue(realitySettings.publicKey);
            if (downloadRealityPublicKey) stream.xhttpDownload.reality.public_key = downloadRealityPublicKey;
            const downloadRealityShortID = toStringValue(realitySettings.shortId);
            if (downloadRealityShortID) stream.xhttpDownload.reality.short_id = downloadRealityShortID;
          }
          const xhttpSettings = toObject(downloadSettings.xhttpSettings);
          if (xhttpSettings) {
            const downloadHost = toStringValue(xhttpSettings.host);
            if (downloadHost && !stream.xhttpDownload.host) stream.xhttpDownload.host = downloadHost;
            const downloadPath = toStringValue(xhttpSettings.path);
            if (downloadPath && !stream.xhttpDownload.path) stream.xhttpDownload.path = downloadPath;
            const downloadMode = toStringValue(xhttpSettings.mode);
            if (downloadMode && !stream.xhttpDownload.mode) stream.xhttpDownload.mode = downloadMode;
            const downloadXPaddingBytes = toStringValue(xhttpSettings.xPaddingBytes);
            if (downloadXPaddingBytes && !stream.xhttpDownload.x_padding_bytes) stream.xhttpDownload.x_padding_bytes = downloadXPaddingBytes;
            const downloadScMaxEachPostBytes = parseIntOrRange(xhttpSettings.scMaxEachPostBytes);
            if (downloadScMaxEachPostBytes !== "" && !stream.xhttpDownload.sc_max_each_post_bytes) stream.xhttpDownload.sc_max_each_post_bytes = downloadScMaxEachPostBytes;
            const downloadScMinPostsIntervalMs = parseIntOrRange(xhttpSettings.scMinPostsIntervalMs);
            if (downloadScMinPostsIntervalMs !== "" && !stream.xhttpDownload.sc_min_posts_interval_ms) stream.xhttpDownload.sc_min_posts_interval_ms = downloadScMinPostsIntervalMs;
            const downloadScStreamUpServerSecs = parseIntOrRange(xhttpSettings.scStreamUpServerSecs);
            if (downloadScStreamUpServerSecs !== "" && !stream.xhttpDownload.sc_stream_up_server_secs) stream.xhttpDownload.sc_stream_up_server_secs = downloadScStreamUpServerSecs;
            const downloadScMaxBufferedPosts = toIntValue(xhttpSettings.scMaxBufferedPosts);
            if (downloadScMaxBufferedPosts > 0 && !stream.xhttpDownload.sc_max_buffered_posts) stream.xhttpDownload.sc_max_buffered_posts = downloadScMaxBufferedPosts;
            const downloadServerMaxHeaderBytes = toIntValue(xhttpSettings.serverMaxHeaderBytes);
            if (downloadServerMaxHeaderBytes > 0 && !stream.xhttpDownload.server_max_header_bytes) stream.xhttpDownload.server_max_header_bytes = downloadServerMaxHeaderBytes;
            if (xhttpSettings.noSSEHeader === true && !stream.xhttpDownload.no_sse_header) {
              stream.xhttpDownload.no_sse_header = "true";
            }
            const downloadHeaders = toObject(xhttpSettings.headers);
            if (!stream.xhttpDownload.headers && downloadHeaders && Object.keys(downloadHeaders).length) {
              stream.xhttpDownload.headers = downloadHeaders;
            }
            const downloadExtra = toObject(xhttpSettings.extra);
            if (downloadExtra) mergeXmuxSettings(stream.xhttpDownload.xmux, downloadExtra.xmux);
          }
        }
      }
      const xhttpQParams = tryJSON(q.get("quicParams") || q.get("quic_params") || "") || {};
      const xhttpFm = toObject(tryJSON(q.get("fm") || q.get("finalmask") || "")) || {};
      const xhttpFinalmask = {};
      const xhttpTcp = tryJSON(q.get("finalmask_tcp") || q.get("finalmask-tcp") || "") || xhttpFm.tcp || [];
      const xhttpUdp = tryJSON(q.get("finalmask_udp") || q.get("finalmask-udp") || "") || xhttpFm.udp || [];
      if (Array.isArray(xhttpTcp) && xhttpTcp.length) xhttpFinalmask.tcp = xhttpTcp;
      if (Array.isArray(xhttpUdp) && xhttpUdp.length) xhttpFinalmask.udp = xhttpUdp;
      const xhttpQuicParams = {};
      if (xhttpFm.quicParams && typeof xhttpFm.quicParams === "object" && !Array.isArray(xhttpFm.quicParams)) {
        Object.assign(xhttpQuicParams, xhttpFm.quicParams);
      }
      if (xhttpQParams && typeof xhttpQParams === "object" && !Array.isArray(xhttpQParams)) {
        Object.assign(xhttpQuicParams, xhttpQParams);
      }
      const xhttpCongestion = (q.get("congestion") || "").trim().toLowerCase();
      const xhttpBrutalUp = (q.get("brutal_up") || q.get("brutalUp") || q.get("up") || "").trim();
      const xhttpBrutalDown = (q.get("brutal_down") || q.get("brutalDown") || q.get("down") || "").trim();
      if (xhttpCongestion && !xhttpQuicParams.congestion) xhttpQuicParams.congestion = xhttpCongestion;
      if (xhttpBrutalUp && !xhttpQuicParams.brutalUp) xhttpQuicParams.brutalUp = xhttpBrutalUp;
      if (xhttpBrutalDown && !xhttpQuicParams.brutalDown) xhttpQuicParams.brutalDown = xhttpBrutalDown;
      if (Object.keys(xhttpQuicParams).length) xhttpFinalmask.quicParams = xhttpQuicParams;
      if (Object.keys(xhttpFinalmask).length) stream.finalmask = xhttpFinalmask;
    } else if (type === "httpupgrade") {
      stream.path = q.get("path") || "";
      stream.host = q.get("host") || "";
    } else if (type === "grpc") {
      stream.path = q.get("serviceName") || "";
      if (!stream.authority) stream.authority = q.get("authority") || "";
    } else if (type === "tcp") {
      if ((q.get("headerType") || "") === "http") {
        stream.headerType = "http";
        stream.path = q.get("path") || "";
        stream.host = q.get("host") || "";
      }
    }
    return stream;
  }

  // src/core/singbox.js
  function buildSingBoxOutbound(bean, opts) {
    const useExtended = !!(opts && opts.useExtended) || !!bean?._useExtended;
    const parseValueList = (raw) => splitCSV(raw || "").filter(Boolean);
    const looksLikeHexSha256 = (value) => /^[0-9a-f]{64}$/i.test(String(value || "").replace(/:/g, ""));
    const resolveCertificatePins = (source) => {
      const directPins = parseValueList(source?.certificatePublicKeySha256 || "");
      if (directPins.length) return directPins;
      return parseValueList(source?.pinnedPeerCertSha256 || "").filter((value) => !looksLikeHexSha256(value));
    };
    const applyTlsExtras = (tls2, source) => {
      const certificatePins = resolveCertificatePins(source || {});
      if (certificatePins.length) tls2.certificate_public_key_sha256 = certificatePins;
      const ech = source?.ech || {};
      if (ech.config || ech.configPath || ech.queryServerName) {
        const echConfig = { enabled: true };
        const configValues = parseValueList(ech.config || "");
        if (configValues.length) echConfig.config = configValues;
        if (ech.configPath) echConfig.config_path = ech.configPath;
        if (ech.queryServerName) echConfig.query_server_name = ech.queryServerName;
        tls2.ech = echConfig;
      }
    };
    const commonTLS = () => {
      const s = bean.stream || {};
      const isReality = !!(s.reality && s.reality.pbk);
      const hasTlsHints = !!(s.sni || s.alpn && s.alpn.length || s.fp);
      const needTls = s.security === "tls" || isReality || ["vless", "vmess"].includes(bean.proto) && hasTlsHints;
      if (!needTls) return void 0;
      const tls2 = { enabled: true };
      if (s.allowInsecure) tls2.insecure = true;
      if (s.sni) tls2.server_name = s.sni;
      if (s.alpn && s.alpn.length) tls2.alpn = s.alpn;
      applyTlsExtras(tls2, s);
      if (isReality) {
        tls2.reality = { enabled: true, public_key: s.reality.pbk, short_id: s.reality.sid || "" };
        if (!s.fp) tls2.utls = { enabled: true, fingerprint: "random" };
      }
      if (s.fp) tls2.utls = { enabled: true, fingerprint: s.fp };
      return tls2;
    };
    const buildExtendedXhttpXmux = (xmux) => {
      const hasXmux = Object.values(xmux || {}).some((v) => v !== "" && v !== 0);
      if (!hasXmux) return null;
      const result = {};
      if (xmux.max_concurrency) result.max_concurrency = xmux.max_concurrency;
      else if (xmux.max_connections) result.max_connections = xmux.max_connections;
      if (xmux.c_max_reuse_times) result.c_max_reuse_times = xmux.c_max_reuse_times;
      if (xmux.h_max_request_times) result.h_max_request_times = xmux.h_max_request_times;
      if (xmux.h_max_reusable_secs) result.h_max_reusable_secs = xmux.h_max_reusable_secs;
      if (xmux.h_keep_alive_period) result.h_keep_alive_period = xmux.h_keep_alive_period;
      return Object.keys(result).length ? result : null;
    };
    function applyTransport(outbound2, stream, packetEncoding) {
      if (stream.network !== "tcp") {
        const t = { type: stream.network };
        if (stream.network === "ws") {
          const hostHeader = stream.host || stream.sni || "";
          if (hostHeader) t.headers = { Host: hostHeader };
          const pathWithoutEd = (stream.path || "").split("?ed=")[0];
          if (pathWithoutEd) t.path = pathWithoutEd;
          const ed = stream.wsEarlyData?.max_early_data || 0;
          const edName = stream.wsEarlyData?.early_data_header_name || "";
          if (ed > 0) {
            t.max_early_data = ed;
            t.early_data_header_name = edName || "Sec-WebSocket-Protocol";
          }
        } else if (stream.network === "http") {
          if (stream.path) t.path = stream.path;
          if (stream.host) t.host = splitCSV(stream.host).map((s) => s);
        } else if (stream.network === "h2") {
          t.type = "http";
          if (stream.path) t.path = stream.path;
          if (stream.host) t.host = splitCSV(stream.host).map((s) => s);
        } else if (stream.network === "xhttp") {
          if (!useExtended) return;
          if (stream.path) t.path = stream.path;
          if (stream.host) t.host = stream.host;
          if (stream.xhttpMode) t.mode = stream.xhttpMode;
          t.x_padding_bytes = "100-1000";
          const xmux = stream.xhttpXmux || {};
          const resolvedXmux = buildExtendedXhttpXmux(xmux);
          if (resolvedXmux) t.xmux = resolvedXmux;
          const download = stream.xhttpDownload || {};
          const hasDownload = Object.values(download).some((v) => v !== "" && v !== 0);
          if (hasDownload) {
            t.download = {};
            if (download.host) t.download.host = download.host;
            if (download.path) t.download.path = download.path;
            if (download.x_padding_bytes) t.download.x_padding_bytes = download.x_padding_bytes;
            if (download.sc_max_each_post_bytes) t.download.sc_max_each_post_bytes = download.sc_max_each_post_bytes;
            if (download.sc_min_posts_interval_ms) t.download.sc_min_posts_interval_ms = download.sc_min_posts_interval_ms;
            if (download.sc_stream_up_server_secs) t.download.sc_stream_up_server_secs = download.sc_stream_up_server_secs;
            if (download.server) t.download.server = download.server;
            if (download.server_port) t.download.server_port = download.server_port;
            if (download.detour) t.download.detour = download.detour;
            if (resolvedXmux) {
              t.download.xmux = resolvedXmux;
            }
          }
        } else if (stream.network === "grpc") {
          if (stream.path) t.service_name = stream.path;
        } else if (stream.network === "httpupgrade") {
          if (stream.path) t.path = stream.path;
          if (stream.host) t.host = stream.host;
        }
        outbound2.transport = t;
      } else if (stream.headerType === "http") {
        outbound2.transport = {
          type: "http",
          method: "GET",
          path: stream.path || "",
          headers: { Host: splitCSV(stream.host) }
        };
      }
      if (outbound2.type === "vmess" || outbound2.type === "vless") {
        if (packetEncoding) outbound2.packet_encoding = packetEncoding;
      }
    }
    let outbound = null;
    if (bean.proto === "vmess") outbound = {
      type: "vmess",
      server: bean.host,
      server_port: bean.port,
      uuid: bean.auth.uuid,
      security: bean.auth.security || "auto"
    };
    else if (bean.proto === "vless") {
      outbound = { type: "vless", server: bean.host, server_port: bean.port, uuid: bean.auth.uuid };
      if (bean.auth.flow) outbound.flow = bean.auth.flow;
    } else if (bean.proto === "trojan") outbound = {
      type: "trojan",
      server: bean.host,
      server_port: bean.port,
      password: bean.auth.password
    };
    else if (bean.proto === "ss") outbound = {
      type: "shadowsocks",
      server: bean.host,
      server_port: bean.port,
      method: bean.ss.method,
      password: bean.ss.password
    };
    else if (bean.proto === "anytls") {
      outbound = {
        type: "anytls",
        server: bean.host,
        server_port: bean.port || 443,
        password: bean.auth.password
      };
    } else if (bean.proto === "socks" || bean.proto === "http") {
      outbound = { type: bean.proto, server: bean.host, server_port: bean.port };
      if (bean.socks?.type === "socks4") outbound.version = "4";
      if (bean.socks?.username && bean.socks?.password) {
        outbound.username = bean.socks.username;
        outbound.password = bean.socks.password;
      }
    } else if (bean.proto === "hy2") {
      const h = bean.hysteria2 || {};
      const tlsFromStream = commonTLS();
      const alpn = splitCSV(h.alpn || "").filter(Boolean);
      const tls2 = Object.assign({ enabled: true }, tlsFromStream || {});
      if (h.allowInsecure) tls2.insecure = true;
      if (h.sni) tls2.server_name = h.sni;
      if (alpn.length) tls2.alpn = alpn;
      else if (!Array.isArray(tls2.alpn) || tls2.alpn.length === 0) tls2.alpn = ["h3"];
      applyTlsExtras(tls2, h);
      outbound = { type: "hysteria2", server: bean.host, server_port: bean.port || 443, tls: tls2 };
      outbound.password = bean.auth.password;
      if (bean.hysteria2?.obfsPassword) {
        outbound.obfs = { type: "salamander", password: bean.hysteria2.obfsPassword };
      }
      if (bean.hysteria2?.hopPort) {
        const raw = String(bean.hysteria2.hopPort || "").trim();
        const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
        const ranges = parts.map((p) => p.includes("-") ? p.replace("-", ":") : p);
        if (ranges.length) {
          outbound.server_ports = ranges;
          delete outbound.server_port;
        }
      }
      if (bean.hysteria2?.hopInterval) {
        const hi = String(bean.hysteria2.hopInterval).trim();
        const hasUnit = /(?:ms|s|m|h|d)$/i.test(hi);
        outbound.hop_interval = hasUnit ? hi : /^\d+$/.test(hi) ? hi + "s" : hi;
      } else {
        outbound.hop_interval = "10s";
      }
    } else if (bean.proto === "tuic") {
      const t = bean.tuic || {};
      const tlsFromStream = commonTLS();
      const alpn = splitCSV(t.alpn || "").filter(Boolean);
      const tls2 = Object.assign({ enabled: true }, tlsFromStream || {});
      if (t.allowInsecure) tls2.insecure = true;
      if (t.disableSni) tls2.disable_sni = true;
      if (t.sni) tls2.server_name = t.sni;
      if (alpn.length) tls2.alpn = alpn;
      applyTlsExtras(tls2, t);
      outbound = { type: "tuic", server: bean.host, server_port: bean.port || 443, tls: tls2 };
      if (bean.tuic?.token) outbound.token = bean.tuic.token;
      else {
        if (bean.auth.uuid) outbound.uuid = bean.auth.uuid;
        if (bean.auth.password) outbound.password = bean.auth.password;
      }
      if (bean.tuic.congestion_control) outbound.congestion_control = bean.tuic.congestion_control;
      if (bean.tuic.udp_over_stream) outbound.udp_over_stream = true;
      else if (bean.tuic.udp_relay_mode) outbound.udp_relay_mode = bean.tuic.udp_relay_mode;
      if (bean.tuic.zero_rtt_handshake) outbound.zero_rtt_handshake = true;
      if (bean.tuic.heartbeat) outbound.heartbeat = bean.tuic.heartbeat;
    } else if (bean.proto === "mieru") {
      outbound = {
        type: "mieru",
        server: bean.host,
        server_port: bean.port
      };
      if (bean.mieru?.server_ports) outbound.server_ports = bean.mieru.server_ports;
      if (bean.mieru?.transport) outbound.transport = bean.mieru.transport;
      if (bean.mieru?.username) outbound.username = bean.mieru.username;
      if (bean.mieru?.password) outbound.password = bean.mieru.password;
      if (bean.mieru?.multiplexing) outbound.multiplexing = bean.mieru.multiplexing;
    } else throw new Error("Not supported by sing-box: " + bean.proto);
    if (bean.proto === "ss") {
      const ss = bean.ss || {};
      const uotVersion = typeof ss.uot === "number" && Number.isFinite(ss.uot) ? ss.uot : 0;
      const smuxEnabled = !!(ss.smux && ss.smux.enabled);
      if (smuxEnabled && uotVersion > 0) {
        throw new Error("shadowsocks: udp-over-tcp conflicts with multiplex");
      }
      outbound.udp_over_tcp = uotVersion > 0 ? { enabled: true, version: uotVersion } : false;
      if (ss.plugin) {
        outbound.plugin = ss.plugin;
        if (ss.pluginOpts) {
          if (typeof ss.pluginOpts === "string") {
            const s = ss.pluginOpts.trim();
            if (s) outbound.plugin_opts = s;
          } else if (typeof ss.pluginOpts === "object") {
            const parts = [];
            for (const [k, v] of Object.entries(ss.pluginOpts)) {
              const key = String(k || "").trim();
              if (!key) continue;
              if (v === true) {
                parts.push(key);
              } else if (v === false || v === void 0 || v === null) {
                continue;
              } else {
                const val = String(v).trim();
                if (!val) continue;
                parts.push(`${key}=${val}`);
              }
            }
            if (parts.length) outbound.plugin_opts = parts.join(";");
          }
        }
      }
      if (smuxEnabled) {
        const smux = ss.smux || {};
        const protocol = String(smux.protocol || "").trim() || "smux";
        outbound.multiplex = { enabled: true, protocol };
        const ms = smux["max-streams"];
        if (Number.isFinite(ms) && ms > 0) outbound.multiplex.max_streams = ms;
      }
    }
    const tls = commonTLS();
    if (tls) outbound.tls = tls;
    if (bean.stream) {
      const packetEncoding = bean.stream && bean.stream.packet_encoding ? bean.stream.packet_encoding : useExtended && outbound.type === "vless" ? "xudp" : "";
      applyTransport(outbound, bean.stream, packetEncoding);
    }
    return outbound;
  }
  function buildSingBoxInbounds(opts) {
    const inbounds = [];
    const androidMode = !!opts.androidMode;
    if (opts.addTun) {
      const specs = parseTunSpec(opts.tunName || "");
      const ifaces = specs.length ? specs.map((x) => x.name) : ["singtun0"];
      for (let i = 0; i < ifaces.length; i++) {
        const name = ifaces[i];
        const tag = ifaces.length > 1 ? `tun-in-${name}` : "tun-in";
        const octet = ifaces.length > 1 ? i === 0 ? 1 : i * 10 : 1;
        const baseAddr = `172.19.0.${octet}`;
        const prefix = ifaces.length > 1 || androidMode ? 30 : 32;
        const cidr = `${baseAddr}/${prefix}`;
        const tun = {
          type: "tun",
          tag,
          interface_name: name,
          address: [cidr],
          stack: "gvisor",
          auto_route: androidMode ? true : false,
          strict_route: androidMode ? true : false
        };
        inbounds.push(tun);
      }
    }
    if (opts.addSocks) {
      const specs = parseTunSpec(opts.tunName || "");
      if (opts.addTun && opts.perTunMixed && specs.length > 1) {
        const ifaces = specs.map((x) => x.name);
        for (let i = 0; i < ifaces.length; i++) {
          const name = ifaces[i];
          inbounds.push({
            tag: `mixed-in-${name}`,
            type: "mixed",
            listen: "127.0.0.1",
            listen_port: 2080 + i
          });
        }
      } else {
        inbounds.push({
          tag: "mixed-in",
          type: "mixed",
          listen: "127.0.0.1",
          listen_port: 2080
        });
      }
    }
    return inbounds;
  }
  function buildDNSServers(dnsBeans) {
    const servers = [];
    for (const bean of dnsBeans) {
      if (bean.proto === "sdns") {
        servers.push({
          type: "sdns",
          stamp: bean.sdns.stamp,
          tag: bean.name || "sdns-server"
        });
      }
    }
    return servers;
  }
  function buildSingBoxWireGuardEndpoint(bean) {
    if (!bean || bean.proto !== "wireguard") throw new Error("wireguard bean required");
    const wg = bean.wireguard || {};
    const ensureCidrPrefix = (raw) => {
      const s = String(raw || "").trim();
      if (!s) return "";
      if (s.includes("/")) return s;
      const isIPv4 = (() => {
        const parts = s.split(".");
        if (parts.length !== 4) return false;
        for (const p of parts) {
          if (!/^\d+$/.test(p)) return false;
          const n = parseInt(p, 10);
          if (!(n >= 0 && n <= 255)) return false;
        }
        return true;
      })();
      if (isIPv4) return `${s}/32`;
      const isIPv6Like = s.includes(":") && /^[0-9a-fA-F:.]+$/.test(s);
      if (isIPv6Like) return `${s}/128`;
      return s;
    };
    const mapPeer = (p) => {
      if (!p || typeof p !== "object") return null;
      const out = {
        address: p.server || "",
        port: p.port || 0
      };
      if (p.publicKey) out.public_key = p.publicKey;
      if (p.preSharedKey) out.pre_shared_key = p.preSharedKey;
      if (Array.isArray(p.allowedIPs) && p.allowedIPs.length) out.allowed_ips = p.allowedIPs;
      if (Number.isFinite(wg.persistentKeepalive) && wg.persistentKeepalive > 0) {
        out.persistent_keepalive_interval = wg.persistentKeepalive;
      }
      if (p.reserved !== void 0) out.reserved = p.reserved;
      if (!out.address || !out.port) return null;
      return out;
    };
    const addr = [];
    if (Array.isArray(wg.addresses) && wg.addresses.length) {
      const normalized = wg.addresses.map(ensureCidrPrefix).filter(Boolean);
      if (normalized.length) addr.push(...normalized);
    }
    if (addr.length === 0) {
      if (wg.ip) addr.push(ensureCidrPrefix(wg.ip));
      if (wg.ipv6) addr.push(ensureCidrPrefix(wg.ipv6));
    }
    const peers = Array.isArray(wg.peers) && wg.peers.length ? wg.peers : [{
      server: bean.host,
      port: bean.port,
      publicKey: wg.publicKey,
      preSharedKey: wg.preSharedKey,
      allowedIPs: wg.allowedIPs,
      reserved: wg.reserved
    }];
    const ep = {
      type: "wireguard",
      tag: bean.name || "wireguard",
      system: false,
      mtu: Number.isFinite(wg.mtu) ? wg.mtu : void 0,
      address: addr,
      private_key: wg.privateKey,
      peers: peers.map(mapPeer).filter(Boolean)
    };
    if (ep.mtu === void 0) delete ep.mtu;
    return ep;
  }
  function buildSingBoxConfig(outboundsWithTags, opts) {
    const effectiveOpts = Object.assign({}, opts || {});
    const effectiveUrlTest = typeof effectiveOpts.urlTest === "string" && effectiveOpts.urlTest.trim() ? effectiveOpts.urlTest.trim() : URLTEST;
    const endpointTags = effectiveOpts && Array.isArray(effectiveOpts.endpoints) ? effectiveOpts.endpoints.map((e) => e?.tag).filter(Boolean) : [];
    const tags = [...outboundsWithTags.map((ob) => ob.tag), ...endpointTags];
    if (effectiveOpts.addTun && effectiveOpts.perTunMixed && !String(effectiveOpts.tunName || "").trim()) {
      const count = tags.length;
      if (count > 1 && !effectiveOpts.androidMode) {
        const names = Array.from({ length: count }, (_, i) => `singtun${i}`);
        effectiveOpts.tunName = names.map((n) => `${n}:select`).join(",");
      }
    }
    const inbounds = buildSingBoxInbounds(effectiveOpts);
    const managementOutbounds = [];
    const routeRules = [];
    const hasMany = tags.length > 1;
    const tunSpecs = parseTunSpec(effectiveOpts?.tunName || "");
    const tunIndexByName = new Map(tunSpecs.map((t, idx) => [t.name, idx]));
    const inboundTagFor = (name) => tunSpecs.length > 1 ? `tun-in-${name}` : "tun-in";
    const mixedInboundTagFor = (name) => tunSpecs.length > 1 ? `mixed-in-${name}` : "mixed-in";
    const defaultOutboundForTun = (name) => {
      if (!tags.length) return "direct";
      const idx = tunIndexByName.has(name) ? tunIndexByName.get(name) : 0;
      const safeIdx = Number.isFinite(idx) && idx >= 0 ? idx : 0;
      return tags[safeIdx % tags.length] || (tags[0] || "direct");
    };
    let createdGlobalAuto = false;
    let createdGlobalSelector = false;
    if (hasMany) {
      const hasPerTunAuto = tunSpecs.some((t) => t.mode === "auto");
      const hasTun = tunSpecs.length > 0;
      if (!hasPerTunAuto && !hasTun) {
        managementOutbounds.push({
          type: "urltest",
          tag: "auto",
          outbounds: tags,
          url: effectiveUrlTest,
          interval: URLTEST_INTERVAL,
          tolerance: 50,
          idle_timeout: "30m",
          interrupt_exist_connections: false
        });
        createdGlobalAuto = true;
        managementOutbounds.push({
          type: "selector",
          tag: "select",
          outbounds: ["auto", ...tags],
          default: "auto",
          interrupt_exist_connections: false
        });
        createdGlobalSelector = true;
      } else if (!hasTun) {
        managementOutbounds.push({
          type: "selector",
          tag: "select",
          outbounds: tags,
          default: tags[0] || "direct",
          interrupt_exist_connections: false
        });
        createdGlobalSelector = true;
      }
    } else {
      const onlyTag = tags[0] || "direct";
      const hasTun = tunSpecs.length > 0;
      if (!hasTun) {
        managementOutbounds.push({
          type: "selector",
          tag: "select",
          outbounds: [onlyTag],
          default: onlyTag,
          interrupt_exist_connections: false
        });
        createdGlobalSelector = true;
      }
    }
    if (tunSpecs.length > 0) {
      const globalAutoAvailable = createdGlobalAuto === true;
      const autoNames = tunSpecs.filter((t) => t.mode === "auto").map((t) => t.name);
      const selectNames = tunSpecs.filter((t) => t.mode === "select").map((t) => t.name);
      for (const name of autoNames) {
        if (hasMany) {
          managementOutbounds.push({
            type: "urltest",
            tag: `auto-${name}`,
            outbounds: tags,
            url: effectiveUrlTest,
            interval: URLTEST_INTERVAL,
            tolerance: 50,
            idle_timeout: "30m",
            interrupt_exist_connections: false
          });
          routeRules.push({ inbound: inboundTagFor(name), outbound: `auto-${name}` });
        } else {
          const onlyTag = tags[0] || "direct";
          routeRules.push({ inbound: inboundTagFor(name), outbound: onlyTag });
        }
      }
      for (const name of selectNames) {
        if (hasMany) {
          const outs = globalAutoAvailable ? ["auto", ...tags] : [...tags];
          const def = globalAutoAvailable ? defaultOutboundForTun(name) : defaultOutboundForTun(name);
          managementOutbounds.push({
            type: "selector",
            tag: `select-${name}`,
            outbounds: outs,
            default: def,
            interrupt_exist_connections: false
          });
          routeRules.push({ inbound: inboundTagFor(name), outbound: `select-${name}` });
        } else {
          const onlyTag = tags[0] || "direct";
          routeRules.push({ inbound: inboundTagFor(name), outbound: onlyTag });
        }
      }
      if (effectiveOpts.addSocks && effectiveOpts.perTunMixed) {
        for (const name of autoNames) {
          const onlyTag = tags[0] || "direct";
          routeRules.push({ inbound: mixedInboundTagFor(name), outbound: hasMany ? `auto-${name}` : onlyTag });
        }
        for (const name of selectNames) {
          const onlyTag = tags[0] || "direct";
          routeRules.push({ inbound: mixedInboundTagFor(name), outbound: hasMany ? `select-${name}` : onlyTag });
        }
      } else if (effectiveOpts.addSocks) {
        const firstTun = tunSpecs[0];
        if (firstTun) {
          const onlyTag = tags[0] || "direct";
          const outbound = hasMany ? firstTun.mode === "auto" ? `auto-${firstTun.name}` : `select-${firstTun.name}` : onlyTag;
          routeRules.push({ inbound: "mixed-in", outbound });
        }
      }
    }
    if (effectiveOpts?.androidMode) {
      routeRules.unshift({ protocol: "dns", action: "hijack-dns" });
      routeRules.unshift({ action: "sniff" });
    }
    routeRules.push({ ip_version: 6, outbound: "block" });
    const outbounds = [
      { tag: "direct", type: "direct" },
      { tag: "block", type: "block" },
      ...managementOutbounds,
      ...outboundsWithTags
    ];
    const experimental = {};
    if (!effectiveOpts?.androidMode) {
      experimental.cache_file = { enabled: true };
      experimental.clash_api = {
        external_controller: "[::]:9090",
        external_ui: "ui",
        external_ui_download_detour: "direct",
        access_control_allow_private_network: true,
        secret: effectiveOpts?.genClashSecret ? generateSecretHex32() : ""
      };
    }
    const config = {
      log: { level: "info" },
      inbounds,
      outbounds,
      route: { rules: routeRules, final: createdGlobalSelector ? "select" : "direct" }
    };
    if (effectiveOpts && Array.isArray(effectiveOpts.endpoints) && effectiveOpts.endpoints.length > 0) {
      config.endpoints = effectiveOpts.endpoints;
    }
    if (Object.keys(experimental).length > 0) {
      config.experimental = experimental;
    }
    const dnsServers = effectiveOpts?.useExtended ? buildDNSServers(effectiveOpts?.dnsBeans || []) : [];
    if (dnsServers.length > 0) {
      config.dns = { servers: dnsServers };
      config.route.default_domain_resolver = dnsServers[0]?.tag || "";
    } else if (effectiveOpts?.androidMode) {
      config.dns = {
        servers: [
          {
            type: "local",
            tag: "local"
          }
        ],
        strategy: "ipv4_only"
      };
      config.route.default_domain_resolver = "local";
    }
    if (effectiveOpts?.androidMode) {
      config.route.auto_detect_interface = true;
      config.route.override_android_vpn = true;
    }
    if (effectiveOpts?.useExtended) {
      if (!config.experimental) config.experimental = {};
      config.experimental.unified_delay = { enabled: true };
    }
    return config;
  }

  // src/core/xray.js
  function buildXrayOutbound(bean) {
    const s = bean.stream || {};
    const network = s.network || "tcp";
    let streamSettings = { network: network === "http" || network === "h2" ? "xhttp" : network };
    const applyXrayEch = (tlsSettings, ech) => {
      if (!tlsSettings || !ech) return;
      if (ech.configList) tlsSettings.echConfigList = ech.configList;
      if (ech.forceQuery) tlsSettings.echForceQuery = ech.forceQuery;
    };
    const applyFinalmask = (streamSettingsTarget, source) => {
      if (!streamSettingsTarget || !source || typeof source !== "object") return;
      const fm = source.finalmask;
      if (!fm || typeof fm !== "object") return;
      const out = {};
      if (Array.isArray(fm.tcp) && fm.tcp.length) out.tcp = fm.tcp;
      if (Array.isArray(fm.udp) && fm.udp.length) out.udp = fm.udp;
      if (fm.quicParams && typeof fm.quicParams === "object" && Object.keys(fm.quicParams).length) {
        out.quicParams = fm.quicParams;
      }
      if (Object.keys(out).length) streamSettingsTarget.finalmask = out;
    };
    const put = (obj, key, value, check) => {
      const ok = check || ((v) => v !== "" && v !== void 0 && v !== null);
      if (ok(value)) obj[key] = value;
    };
    const buildXmuxSettings = (xmux) => {
      if (!xmux || typeof xmux !== "object") return null;
      const out = {};
      put(out, "maxConcurrency", xmux.max_concurrency);
      put(out, "maxConnections", xmux.max_connections);
      put(out, "cMaxReuseTimes", xmux.c_max_reuse_times);
      put(out, "hMaxRequestTimes", xmux.h_max_request_times);
      put(out, "hMaxReusableSecs", xmux.h_max_reusable_secs);
      put(out, "hKeepAlivePeriod", xmux.h_keep_alive_period, (v) => Number.isFinite(v) && v > 0);
      return Object.keys(out).length ? out : null;
    };
    const applyXhttpExtrasFromStream = (xhttpSettings, source) => {
      if (!xhttpSettings || !source || typeof source !== "object") return;
      put(xhttpSettings, "xPaddingBytes", source.xhttpXPaddingBytes);
      if (source.xhttpNoGrpcHeader === true) xhttpSettings.noGRPCHeader = true;
      if (typeof source.xhttpXPaddingObfsMode === "boolean") xhttpSettings.xPaddingObfsMode = source.xhttpXPaddingObfsMode;
      [
        ["xPaddingKey", "xhttpXPaddingKey"],
        ["xPaddingHeader", "xhttpXPaddingHeader"],
        ["xPaddingPlacement", "xhttpXPaddingPlacement"],
        ["xPaddingMethod", "xhttpXPaddingMethod"],
        ["uplinkHTTPMethod", "xhttpUplinkHttpMethod"],
        ["sessionPlacement", "xhttpSessionPlacement"],
        ["sessionKey", "xhttpSessionKey"],
        ["seqPlacement", "xhttpSeqPlacement"],
        ["seqKey", "xhttpSeqKey"],
        ["uplinkDataPlacement", "xhttpUplinkDataPlacement"],
        ["uplinkDataKey", "xhttpUplinkDataKey"],
        ["scMaxEachPostBytes", "xhttpScMaxEachPostBytes"],
        ["scMinPostsIntervalMs", "xhttpScMinPostsIntervalMs"]
      ].forEach(([dst, src]) => put(xhttpSettings, dst, source[src]));
      if (source.xhttpNoSseHeader === true) xhttpSettings.noSSEHeader = true;
      put(xhttpSettings, "scMaxBufferedPosts", source.xhttpScMaxBufferedPosts, (v) => Number.isFinite(v) && v > 0);
      put(xhttpSettings, "scStreamUpServerSecs", source.xhttpScStreamUpServerSecs);
      put(xhttpSettings, "serverMaxHeaderBytes", source.xhttpServerMaxHeaderBytes, (v) => Number.isFinite(v) && v > 0);
      put(xhttpSettings, "uplinkChunkSize", source.xhttpUplinkChunkSize, (v) => Number.isFinite(v) && v > 0);
    };
    const buildDownloadSettings = (download, security, tlsSettings, realitySettings) => {
      if (!download || typeof download !== "object") return null;
      const dx = download.xmux || {};
      const hasExplicitDownload = !!(download.host || download.path || download.mode || download.headers || download.x_padding_bytes || download.no_sse_header || download.sc_max_each_post_bytes || download.sc_min_posts_interval_ms || download.sc_stream_up_server_secs || download.sc_max_buffered_posts || download.server_max_header_bytes || download.server || download.server_port || dx.max_concurrency || dx.max_connections || dx.c_max_reuse_times || dx.h_max_request_times || dx.h_max_reusable_secs || dx.h_keep_alive_period);
      if (!hasExplicitDownload) return null;
      const address = download.server || bean.host;
      const port = download.server_port || bean.port || 0;
      if (!address || !port) return null;
      const xhttpSettings = {};
      if (download.host) xhttpSettings.host = download.host;
      if (download.path) xhttpSettings.path = download.path;
      if (download.mode) xhttpSettings.mode = download.mode;
      if (download.headers && typeof download.headers === "object" && Object.keys(download.headers).length) {
        xhttpSettings.headers = download.headers;
      }
      if (download.x_padding_bytes) xhttpSettings.xPaddingBytes = download.x_padding_bytes;
      if (download.no_sse_header === true || download.no_sse_header === "true" || download.no_sse_header === "1") {
        xhttpSettings.noSSEHeader = true;
      }
      if (download.sc_max_each_post_bytes) xhttpSettings.scMaxEachPostBytes = download.sc_max_each_post_bytes;
      if (download.sc_min_posts_interval_ms) xhttpSettings.scMinPostsIntervalMs = download.sc_min_posts_interval_ms;
      if (download.sc_stream_up_server_secs) xhttpSettings.scStreamUpServerSecs = download.sc_stream_up_server_secs;
      if (download.sc_max_buffered_posts) xhttpSettings.scMaxBufferedPosts = download.sc_max_buffered_posts;
      if (download.server_max_header_bytes) xhttpSettings.serverMaxHeaderBytes = download.server_max_header_bytes;
      const downloadXmux = buildXmuxSettings(dx);
      if (downloadXmux) xhttpSettings.xmux = downloadXmux;
      const config = {
        address,
        port,
        network: "xhttp",
        xhttpSettings
      };
      if (security === "tls" && tlsSettings) {
        config.security = "tls";
        config.tlsSettings = { ...tlsSettings };
      } else if (security === "reality" && realitySettings) {
        config.security = "reality";
        config.realitySettings = { ...realitySettings };
      }
      return config;
    };
    if (bean.proto === "hy2") {
      const h = bean.hysteria2 || {};
      const alpn = (h.alpn || "").split(",").map((x) => x.trim()).filter(Boolean);
      streamSettings = {
        network: "hysteria",
        security: "tls",
        tlsSettings: {
          serverName: h.sni || void 0,
          alpn: alpn.length ? alpn : void 0,
          pinnedPeerCertSha256: (h.pinnedPeerCertSha256 || "").trim() || void 0,
          verifyPeerCertByName: (h.verifyPeerCertByName || "").trim() || void 0
        },
        hysteriaSettings: {
          version: 2,
          auth: bean.auth?.password || ""
        }
      };
      if (h.obfsPassword) {
        streamSettings.udpmasks = [{
          type: "salamander",
          settings: { password: h.obfsPassword }
        }];
      }
      applyFinalmask(streamSettings, h);
      applyXrayEch(streamSettings.tlsSettings, h.ech);
      if (streamSettings.tlsSettings) {
        if (!streamSettings.tlsSettings.serverName) delete streamSettings.tlsSettings.serverName;
        if (!streamSettings.tlsSettings.alpn) delete streamSettings.tlsSettings.alpn;
        if (!streamSettings.tlsSettings.pinnedPeerCertSha256) delete streamSettings.tlsSettings.pinnedPeerCertSha256;
        if (!streamSettings.tlsSettings.verifyPeerCertByName) delete streamSettings.tlsSettings.verifyPeerCertByName;
        if (!streamSettings.tlsSettings.echConfigList) delete streamSettings.tlsSettings.echConfigList;
        if (!streamSettings.tlsSettings.echForceQuery) delete streamSettings.tlsSettings.echForceQuery;
        if (Object.keys(streamSettings.tlsSettings).length === 0) delete streamSettings.tlsSettings;
      }
    } else {
      const hasReality = !!(s.reality && s.reality.pbk);
      const sec = hasReality ? "reality" : s.security === "tls" ? "tls" : "";
      if (sec === "tls") {
        streamSettings.security = "tls";
        streamSettings.tlsSettings = {};
        if (s.sni) streamSettings.tlsSettings.serverName = s.sni;
        if (s.alpn && s.alpn.length) streamSettings.tlsSettings.alpn = s.alpn;
        if (s.fp) streamSettings.tlsSettings.fingerprint = s.fp;
        if (s.pinnedPeerCertSha256) streamSettings.tlsSettings.pinnedPeerCertSha256 = s.pinnedPeerCertSha256;
        if (s.verifyPeerCertByName) streamSettings.tlsSettings.verifyPeerCertByName = s.verifyPeerCertByName;
        applyXrayEch(streamSettings.tlsSettings, s.ech);
      } else if (sec === "reality") {
        streamSettings.security = "reality";
        streamSettings.realitySettings = { show: false, publicKey: s.reality.pbk };
        if (s.reality.sid) streamSettings.realitySettings.shortId = s.reality.sid;
        if (s.reality.spx) streamSettings.realitySettings.spiderX = s.reality.spx;
        if (s.reality.pqv) {
          const pqv = String(s.reality.pqv || "").trim();
          const decoded = decodeBase64Url(pqv);
          if (!decoded || decoded.length !== 1952) {
            throw new Error("Xray REALITY pqv is invalid (expected base64url ML-DSA-65 public key)");
          }
          streamSettings.realitySettings.mldsa65Verify = pqv;
        }
        if (s.sni) streamSettings.realitySettings.serverName = s.sni;
        if (s.fp) streamSettings.realitySettings.fingerprint = s.fp;
      }
      if (streamSettings.network === "ws") {
        streamSettings.wsSettings = {};
        if (s.host) streamSettings.wsSettings.host = s.host;
        let wsPath = s.path || "";
        if (s.wsEarlyData) {
          let ed = 0;
          if (typeof s.wsEarlyData === "object") {
            ed = asInt(s.wsEarlyData.max_early_data ?? s.wsEarlyData.maxEarlyData, 0);
          } else {
            ed = asInt(s.wsEarlyData, 0);
          }
          if (ed > 0 && !/\bed=/.test(wsPath)) {
            if (!wsPath) wsPath = "/";
            wsPath += (wsPath.includes("?") ? "&" : "?") + `ed=${ed}`;
          }
        }
        if (wsPath) streamSettings.wsSettings.path = wsPath;
      } else if (streamSettings.network === "xhttp") {
        streamSettings.xhttpSettings = {};
        if (s.host) streamSettings.xhttpSettings.host = s.host;
        if (s.path) streamSettings.xhttpSettings.path = s.path;
        if (s.xhttpMode) streamSettings.xhttpSettings.mode = s.xhttpMode;
        else streamSettings.xhttpSettings.mode = "auto";
        applyXhttpExtrasFromStream(streamSettings.xhttpSettings, s);
        const xmuxSettings = buildXmuxSettings(s.xhttpXmux || {});
        if (xmuxSettings) streamSettings.xhttpSettings.xmux = xmuxSettings;
        const downloadSettings = buildDownloadSettings(s.xhttpDownload, sec, streamSettings.tlsSettings, streamSettings.realitySettings);
        if (downloadSettings) streamSettings.xhttpSettings.downloadSettings = downloadSettings;
      } else if (streamSettings.network === "grpc") {
        streamSettings.grpcSettings = {};
        if (s.path) streamSettings.grpcSettings.serviceName = s.path;
        if (s.authority) streamSettings.grpcSettings.authority = s.authority;
        if (s.grpcUserAgent) streamSettings.grpcSettings.user_agent = s.grpcUserAgent;
      } else if (streamSettings.network === "httpupgrade") {
        streamSettings.httpupgradeSettings = {};
        if (s.host) streamSettings.httpupgradeSettings.host = s.host;
        if (s.path) streamSettings.httpupgradeSettings.path = s.path;
      } else if (streamSettings.network === "tcp" && s.headerType === "http") {
        streamSettings.tcpSettings = { header: { type: "http", request: { headers: { Host: s.host } } } };
        if (s.path) streamSettings.tcpSettings.header.request.path = [s.path];
      }
      if (streamSettings.network === "xhttp" && streamSettings.tlsSettings && Array.isArray(streamSettings.tlsSettings.alpn)) {
        streamSettings.tlsSettings.alpn = streamSettings.tlsSettings.alpn.filter((v) => (v || "").toLowerCase() !== "http/1.1");
        if (streamSettings.tlsSettings.alpn.length === 0) delete streamSettings.tlsSettings.alpn;
      }
      applyFinalmask(streamSettings, s);
    }
    let outbound = null;
    if (bean.proto === "vmess") {
      outbound = {
        protocol: "vmess",
        tag: bean.name || "vmess",
        settings: {
          vnext: [{
            address: bean.host,
            port: bean.port,
            users: [{
              id: bean.auth.uuid,
              security: bean.auth.security || "auto"
            }]
          }]
        }
      };
    } else if (bean.proto === "vless") {
      const enc = bean.auth && typeof bean.auth.encryption === "string" && bean.auth.encryption.trim() ? bean.auth.encryption.trim() : "none";
      const user = { id: bean.auth.uuid, encryption: enc };
      if (bean.auth.flow) user.flow = bean.auth.flow;
      outbound = {
        protocol: "vless",
        tag: bean.name || "vless",
        settings: { vnext: [{ address: bean.host, port: bean.port, users: [user] }] }
      };
    } else if (bean.proto === "trojan") outbound = {
      protocol: "trojan",
      tag: bean.name || "trojan",
      settings: { servers: [{ address: bean.host, port: bean.port, password: bean.auth.password }] }
    };
    else if (bean.proto === "ss") outbound = {
      protocol: "shadowsocks",
      tag: bean.name || "ss",
      settings: {
        servers: [{
          address: bean.host,
          port: bean.port,
          method: bean.ss.method,
          password: bean.ss.password,
          uot: Number.isFinite(bean.ss?.uot) && bean.ss.uot > 0,
          uotVersion: Number.isFinite(bean.ss?.uot) && bean.ss.uot > 0 ? bean.ss.uot : 0
        }]
      }
    };
    else if (bean.proto === "socks" || bean.proto === "http") {
      const s2 = { address: bean.host, port: bean.port };
      if (bean.socks?.username && bean.socks?.password) {
        s2.users = [{ user: bean.socks.username, pass: bean.socks.password }];
      }
      outbound = { protocol: bean.proto, tag: bean.name || bean.proto, settings: { servers: [s2] } };
    } else if (bean.proto === "hy2") {
      outbound = {
        protocol: "hysteria",
        tag: bean.name || "hy2",
        settings: {
          version: 2,
          address: bean.host,
          port: bean.port || 443
        }
      };
    } else if (bean.proto === "tuic") {
      throw new Error(bean.proto + " not supported in Xray");
    } else {
      throw new Error("Unknown protocol: " + bean.proto);
    }
    outbound.streamSettings = streamSettings;
    return outbound;
  }
  function buildXrayTunInbounds(opts, outboundsCount) {
    const addTun = !!(opts && opts.addTun);
    if (!addTun) return [];
    if (!Number.isFinite(outboundsCount) || outboundsCount <= 0) return [];
    const enableBalancer = !!(opts && opts.enableBalancer);
    const count = !enableBalancer && outboundsCount > 1 ? outboundsCount : 1;
    const ifaces = Array.from({ length: count }, (_, i) => `xraytun${i}`);
    const tunInbounds = [];
    for (let i = 0; i < ifaces.length; i++) {
      const name = ifaces[i] || "xraytun0";
      const tag = `tun-in-${name}`;
      const inbound = {
        tag,
        port: 0,
        protocol: "tun",
        settings: { name }
      };
      tunInbounds.push(inbound);
    }
    return tunInbounds;
  }
  function buildXrayConfig(outbounds, opts) {
    if (!Array.isArray(outbounds)) outbounds = [outbounds];
    const xraySocks = opts && opts.addSocks === void 0 ? true : !!(opts && opts.addSocks);
    const probeUrl = opts && typeof opts.urlTest === "string" && opts.urlTest.trim() ? opts.urlTest.trim() : URLTEST;
    if (outbounds.length === 1) {
      const config2 = {
        log: { loglevel: "warning" },
        inbounds: xraySocks ? [{ tag: "socks-in", port: 1080, listen: "127.0.0.1", protocol: "socks", settings: { udp: true } }] : [],
        outbounds: [outbounds[0], { tag: "direct", protocol: "freedom" }, { tag: "block", protocol: "blackhole" }]
      };
      const tunInbounds2 = buildXrayTunInbounds(opts, outbounds.length);
      if (tunInbounds2.length) {
        config2.inbounds = [...tunInbounds2, ...config2.inbounds];
        config2.routing = {
          rules: [{ inboundTag: tunInbounds2.map((x) => x.tag).filter(Boolean), outboundTag: outbounds[0].tag || "proxy" }]
        };
      } else if (!xraySocks) {
        throw new Error("Xray: at least one inbound (TUN or SOCKS) is required");
      }
      return config2;
    }
    const basePort = 1080;
    const enableBalancer = !!(opts && opts.enableBalancer);
    const tunInbounds = buildXrayTunInbounds(opts, outbounds.length);
    const inbounds = xraySocks ? enableBalancer ? [{ tag: "socks-in", port: basePort, listen: "127.0.0.1", protocol: "socks", settings: { udp: true } }] : outbounds.map((ob, idx) => ({
      tag: `socks-in-${idx + 1}`,
      port: basePort + idx,
      listen: "127.0.0.1",
      protocol: "socks",
      settings: { udp: true }
    })) : [];
    if (tunInbounds.length) {
      inbounds.unshift(...tunInbounds);
    }
    const rules = [];
    if (xraySocks) {
      if (enableBalancer) {
        rules.push({ inboundTag: ["socks-in"], balancerTag: "auto" });
      } else {
        rules.push(...outbounds.map((ob, idx) => ({
          inboundTag: [`socks-in-${idx + 1}`],
          outboundTag: ob.tag || "proxy"
        })));
      }
    }
    if (tunInbounds.length) {
      if (enableBalancer) {
        rules.unshift({ inboundTag: tunInbounds.map((x) => x.tag).filter(Boolean), balancerTag: "auto" });
      } else {
        const tags = outbounds.map((ob) => ob.tag).filter(Boolean);
        for (let i = tunInbounds.length - 1; i >= 0; i--) {
          const obTag = tags[i] || tags[0] || "proxy";
          rules.unshift({ inboundTag: [tunInbounds[i].tag], outboundTag: obTag });
        }
      }
    }
    if (!rules.length) {
      throw new Error("Xray: at least one inbound (TUN or SOCKS) is required");
    }
    const routing = enableBalancer ? {
      rules,
      balancers: [{
        tag: "auto",
        selector: outbounds.map((ob) => ob.tag).filter(Boolean),
        strategy: { type: "leastPing" }
      }]
    } : { rules };
    const config = {
      log: { loglevel: "warning" },
      inbounds,
      outbounds: [...outbounds, { tag: "direct", protocol: "freedom" }, { tag: "block", protocol: "blackhole" }],
      routing
    };
    if (enableBalancer) {
      const selector = outbounds.map((ob) => ob.tag).filter(Boolean);
      config.observatory = {
        subjectSelector: selector,
        probeURL: probeUrl,
        probeInterval: URLTEST_INTERVAL,
        enableConcurrency: selector.length > 8
      };
    }
    return config;
  }

  // src/core/mihomo.js
  var FASTEST_GROUP_NAME = "\u26A1 Fastest";
  var GLOBAL_GROUP_NAME = "GLOBAL";
  var PER_PROXY_GROUP_PREFIX = "\u{1F512} ";
  function getPerProxyGroupName(proxyName) {
    return `${PER_PROXY_GROUP_PREFIX}${proxyName}`;
  }
  function uniqueTargets(...parts) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    parts.flat().forEach((item) => {
      const name = String(item || "").trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push(name);
    });
    return out;
  }
  function getUrlTest(opts) {
    return resolveUrlTest(opts?.urlTest);
  }
  function getUrlTestExpectedStatus(opts) {
    return resolveUrlTestExpectedStatus(opts?.urlTest);
  }
  function sanitizeProviderName(name) {
    const raw = String(name || "").trim().toLowerCase();
    if (!raw) return "";
    const cleaned = raw.replace(/^www\./, "").replace(/[^a-z0-9._-]+/g, "-").replace(/[._-]{2,}/g, "-").replace(/^[._-]+|[._-]+$/g, "");
    return cleaned.slice(0, 48);
  }
  function computeProviderName(url, index, total, used) {
    let base = "";
    try {
      const u = new URL(String(url || "").trim());
      base = sanitizeProviderName(u.hostname || "");
    } catch {
    }
    if (!base) {
      base = total === 1 ? "my_subscription" : `subscription_${index + 1}`;
    }
    let name = base;
    let i = 2;
    while (used.has(name)) {
      name = `${base}-${i++}`;
    }
    used.add(name);
    return name;
  }
  function isPerProxyListenerMode(opts) {
    return !!(opts && (opts.perProxyPort || opts.perProxyListeners));
  }
  function attachPerProxySelectGroup(groups, proxy) {
    const groupName = getPerProxyGroupName(proxy.name);
    groups.push({
      name: groupName,
      type: "select",
      proxies: [proxy.name, "REJECT"]
    });
    return groupName;
  }
  function buildMihomoProxy(bean) {
    const s = bean.stream || {};
    const base = { name: bean.name || computeTag(bean, /* @__PURE__ */ new Set()), type: "", server: bean.host, port: bean.port };
    const applyCommon = (obj) => {
      if (bean.udp === true) obj.udp = true;
      if (bean.udpOverTcp === true) obj["udp-over-tcp"] = true;
      if (bean.ipVersion) obj["ip-version"] = bean.ipVersion;
    };
    const applyTls = (obj) => {
      if (s.security === "tls") {
        obj.tls = true;
        if (s.sni) {
          obj.servername = s.sni;
          if (bean.proto === "http" || bean.proto === "tuic" || bean.proto === "hy2" || bean.proto === "trojan") {
            obj.sni = s.sni;
          }
        }
        if (s.alpn && s.alpn.length) obj.alpn = s.alpn;
        if (s.allowInsecure) obj["skip-cert-verify"] = true;
        if (s.fp) obj["client-fingerprint"] = s.fp;
        if (s.reality && s.reality.pbk) {
          const ro = { "public-key": s.reality.pbk };
          if (s.reality.sid) ro["short-id"] = s.reality.sid;
          if (s.reality.spx) ro["spider-x"] = s.reality.spx;
          if (s.reality.pqv) ro.pqv = s.reality.pqv;
          obj["reality-opts"] = ro;
        }
      }
    };
    const applyPacketEncoding = (obj) => {
      const packetEncoding = String(s.packet_encoding || "").trim().toLowerCase();
      if (packetEncoding === "none") return;
      if (packetEncoding === "packet") obj["packet-addr"] = true;
      else obj.xudp = true;
    };
    const applyNetwork = (obj) => {
      if (s.network === "ws") {
        obj.network = "ws";
        obj["ws-opts"] = {};
        if (s.path) obj["ws-opts"].path = s.path;
        if (s.host) obj["ws-opts"].headers = { Host: s.host };
        if (s.wsEarlyData && s.wsEarlyData.max_early_data) {
          obj["ws-opts"]["max-early-data"] = s.wsEarlyData.max_early_data;
          if (s.wsEarlyData.early_data_header_name) obj["ws-opts"]["early-data-header-name"] = s.wsEarlyData.early_data_header_name;
        }
      } else if (s.network === "http") {
        obj.network = "http";
        obj["http-opts"] = {};
        if (s.path) obj["http-opts"].path = [s.path];
        if (s.host) obj["http-opts"].host = s.host.split(",").map((x) => x.trim()).filter(Boolean);
      } else if (s.network === "h2") {
        obj.network = "h2";
        obj["h2-opts"] = {};
        if (s.path) obj["h2-opts"].path = s.path;
        if (s.host) obj["h2-opts"].host = s.host.split(",").map((x) => x.trim()).filter(Boolean);
      } else if (s.network === "grpc") {
        obj.network = "grpc";
        obj["grpc-opts"] = {};
        if (s.path) obj["grpc-opts"]["grpc-service-name"] = s.path;
        if (s.authority) obj["grpc-opts"].authority = s.authority;
        if (s.grpcUserAgent) obj["grpc-opts"]["grpc-user-agent"] = s.grpcUserAgent;
        if (Number.isFinite(s.grpcPingInterval) && s.grpcPingInterval > 0) {
          obj["grpc-opts"]["ping-interval"] = s.grpcPingInterval;
        }
        if (Number.isFinite(s.grpcMaxConnections) && s.grpcMaxConnections > 0) {
          obj["grpc-opts"]["max-connections"] = s.grpcMaxConnections;
        }
        if (Number.isFinite(s.grpcMinStreams) && s.grpcMinStreams >= 0) {
          obj["grpc-opts"]["min-streams"] = s.grpcMinStreams;
        }
        if (Number.isFinite(s.grpcMaxStreams) && s.grpcMaxStreams >= 0) {
          obj["grpc-opts"]["max-streams"] = s.grpcMaxStreams;
        }
      } else if (s.network === "xhttp") {
        obj.network = "xhttp";
        obj["xhttp-opts"] = {};
        if (s.path) obj["xhttp-opts"].path = s.path;
        if (s.host) obj["xhttp-opts"].host = s.host;
        if (s.xhttpMode) obj["xhttp-opts"].mode = s.xhttpMode;
        else obj["xhttp-opts"].mode = "auto";
        obj["xhttp-opts"]["x-padding-bytes"] = s.xhttpXPaddingBytes || "100-1000";
        if (s.xhttpNoGrpcHeader === true) obj["xhttp-opts"]["no-grpc-header"] = true;
        if (s.xhttpNoSseHeader === true) obj["xhttp-opts"]["no-sse-header"] = true;
        if (typeof s.xhttpXPaddingObfsMode === "boolean") obj["xhttp-opts"]["x-padding-obfs-mode"] = s.xhttpXPaddingObfsMode;
        if (s.xhttpXPaddingKey) obj["xhttp-opts"]["x-padding-key"] = s.xhttpXPaddingKey;
        if (s.xhttpXPaddingHeader) obj["xhttp-opts"]["x-padding-header"] = s.xhttpXPaddingHeader;
        if (s.xhttpXPaddingPlacement) obj["xhttp-opts"]["x-padding-placement"] = s.xhttpXPaddingPlacement;
        if (s.xhttpXPaddingMethod) obj["xhttp-opts"]["x-padding-method"] = s.xhttpXPaddingMethod;
        if (s.xhttpUplinkHttpMethod) obj["xhttp-opts"]["uplink-http-method"] = s.xhttpUplinkHttpMethod;
        if (s.xhttpSessionPlacement) obj["xhttp-opts"]["session-placement"] = s.xhttpSessionPlacement;
        if (s.xhttpSessionKey) obj["xhttp-opts"]["session-key"] = s.xhttpSessionKey;
        if (s.xhttpSeqPlacement) obj["xhttp-opts"]["seq-placement"] = s.xhttpSeqPlacement;
        if (s.xhttpSeqKey) obj["xhttp-opts"]["seq-key"] = s.xhttpSeqKey;
        if (s.xhttpUplinkDataPlacement) obj["xhttp-opts"]["uplink-data-placement"] = s.xhttpUplinkDataPlacement;
        if (s.xhttpUplinkDataKey) obj["xhttp-opts"]["uplink-data-key"] = s.xhttpUplinkDataKey;
        if (Number.isFinite(s.xhttpUplinkChunkSize) && s.xhttpUplinkChunkSize > 0) {
          obj["xhttp-opts"]["uplink-chunk-size"] = s.xhttpUplinkChunkSize;
        }
        if (s.xhttpScMaxEachPostBytes !== "" && s.xhttpScMaxEachPostBytes !== void 0) {
          obj["xhttp-opts"]["sc-max-each-post-bytes"] = s.xhttpScMaxEachPostBytes;
        }
        if (Number.isFinite(s.xhttpScMaxBufferedPosts) && s.xhttpScMaxBufferedPosts > 0) {
          obj["xhttp-opts"]["sc-max-buffered-posts"] = s.xhttpScMaxBufferedPosts;
        }
        if (s.xhttpScMinPostsIntervalMs !== "" && s.xhttpScMinPostsIntervalMs !== void 0) {
          obj["xhttp-opts"]["sc-min-posts-interval-ms"] = s.xhttpScMinPostsIntervalMs;
        }
        if (s.xhttpScStreamUpServerSecs !== "" && s.xhttpScStreamUpServerSecs !== void 0) {
          obj["xhttp-opts"]["sc-stream-up-server-secs"] = s.xhttpScStreamUpServerSecs;
        }
        if (Number.isFinite(s.xhttpServerMaxHeaderBytes) && s.xhttpServerMaxHeaderBytes > 0) {
          obj["xhttp-opts"]["server-max-header-bytes"] = s.xhttpServerMaxHeaderBytes;
        }
        const xmux = s.xhttpXmux || {};
        const reuseSettings = {};
        if (xmux.max_connections) reuseSettings["max-connections"] = xmux.max_connections;
        if (xmux.max_concurrency) reuseSettings["max-concurrency"] = xmux.max_concurrency;
        if (xmux.c_max_reuse_times) reuseSettings["c-max-reuse-times"] = xmux.c_max_reuse_times;
        if (xmux.h_max_request_times) reuseSettings["h-max-request-times"] = xmux.h_max_request_times;
        if (xmux.h_max_reusable_secs) reuseSettings["h-max-reusable-secs"] = xmux.h_max_reusable_secs;
        if (xmux.h_keep_alive_period) reuseSettings["h-keep-alive-period"] = xmux.h_keep_alive_period;
        if (Object.keys(reuseSettings).length) {
          obj["xhttp-opts"]["reuse-settings"] = reuseSettings;
        }
        const download = s.xhttpDownload || {};
        const hasDownload = [
          download.mode,
          download.host,
          download.path,
          download.x_padding_bytes,
          download.sc_max_each_post_bytes,
          download.sc_min_posts_interval_ms,
          download.sc_stream_up_server_secs,
          download.sc_max_buffered_posts,
          download.server_max_header_bytes,
          download.no_sse_header,
          download.server,
          download.server_port,
          download.security,
          download.servername,
          download.client_fingerprint,
          download.alpn,
          download.skip_cert_verify,
          download.detour,
          download.headers
        ].some((v) => {
          if (!v) return false;
          if (typeof v === "object") return Object.keys(v).length > 0;
          return true;
        }) || Object.values(download.xmux || {}).some((v) => v !== "" && v !== 0) || download.reality && typeof download.reality === "object" && Object.values(download.reality).some((v) => String(v || "").trim() !== "");
        if (hasDownload) {
          obj["xhttp-opts"]["download-settings"] = {};
          if (download.mode) obj["xhttp-opts"]["download-settings"].mode = download.mode;
          if (download.host) obj["xhttp-opts"]["download-settings"].host = download.host;
          if (download.path) obj["xhttp-opts"]["download-settings"].path = download.path;
          if (download.headers && typeof download.headers === "object" && Object.keys(download.headers).length) {
            obj["xhttp-opts"]["download-settings"].headers = download.headers;
          }
          if (download.x_padding_bytes) obj["xhttp-opts"]["download-settings"]["x-padding-bytes"] = download.x_padding_bytes;
          if (download.no_sse_header === true || download.no_sse_header === "true" || download.no_sse_header === "1") {
            obj["xhttp-opts"]["download-settings"]["no-sse-header"] = true;
          }
          if (download.sc_max_each_post_bytes) {
            obj["xhttp-opts"]["download-settings"]["sc-max-each-post-bytes"] = download.sc_max_each_post_bytes;
          }
          if (download.sc_min_posts_interval_ms) {
            obj["xhttp-opts"]["download-settings"]["sc-min-posts-interval-ms"] = download.sc_min_posts_interval_ms;
          }
          if (download.sc_stream_up_server_secs) {
            obj["xhttp-opts"]["download-settings"]["sc-stream-up-server-secs"] = download.sc_stream_up_server_secs;
          }
          if (download.sc_max_buffered_posts) {
            obj["xhttp-opts"]["download-settings"]["sc-max-buffered-posts"] = download.sc_max_buffered_posts;
          }
          if (download.server_max_header_bytes) {
            obj["xhttp-opts"]["download-settings"]["server-max-header-bytes"] = download.server_max_header_bytes;
          }
          if (download.server) obj["xhttp-opts"]["download-settings"].server = download.server;
          if (download.server_port) obj["xhttp-opts"]["download-settings"].port = download.server_port;
          const downloadSecurity = String(download.security || "").toLowerCase();
          if (downloadSecurity === "tls" || downloadSecurity === "reality") {
            obj["xhttp-opts"]["download-settings"].tls = true;
            if (download.servername) obj["xhttp-opts"]["download-settings"].servername = download.servername;
            if (download.client_fingerprint) obj["xhttp-opts"]["download-settings"]["client-fingerprint"] = download.client_fingerprint;
            if (Array.isArray(download.alpn) && download.alpn.length) obj["xhttp-opts"]["download-settings"].alpn = download.alpn;
            if (download.skip_cert_verify === true) obj["xhttp-opts"]["download-settings"]["skip-cert-verify"] = true;
            if (downloadSecurity === "reality") {
              const realitySource = download.reality || {};
              const publicKey = realitySource.pbk || realitySource.public_key || "";
              const shortID = realitySource.sid || realitySource.short_id || "";
              const realityOpts = {};
              if (publicKey) realityOpts["public-key"] = publicKey;
              if (shortID) realityOpts["short-id"] = shortID;
              if (Object.keys(realityOpts).length) obj["xhttp-opts"]["download-settings"]["reality-opts"] = realityOpts;
            }
          }
          const dx = download.xmux || {};
          const downloadReuseSettings = {};
          if (dx.max_connections) downloadReuseSettings["max-connections"] = dx.max_connections;
          if (dx.max_concurrency) downloadReuseSettings["max-concurrency"] = dx.max_concurrency;
          if (dx.c_max_reuse_times) downloadReuseSettings["c-max-reuse-times"] = dx.c_max_reuse_times;
          if (dx.h_max_request_times) downloadReuseSettings["h-max-request-times"] = dx.h_max_request_times;
          if (dx.h_max_reusable_secs) downloadReuseSettings["h-max-reusable-secs"] = dx.h_max_reusable_secs;
          if (dx.h_keep_alive_period) downloadReuseSettings["h-keep-alive-period"] = dx.h_keep_alive_period;
          if (Object.keys(downloadReuseSettings).length) {
            obj["xhttp-opts"]["download-settings"]["reuse-settings"] = downloadReuseSettings;
          }
        }
      } else if (s.network === "httpupgrade") {
        obj.network = "httpupgrade";
        obj["ws-opts"] = {};
        if (s.path) obj["ws-opts"].path = s.path;
        if (s.host) obj["ws-opts"].headers = { Host: s.host };
        if (s.wsEarlyData && s.wsEarlyData.max_early_data) {
          obj["ws-opts"]["v2ray-http-upgrade-fast-open"] = true;
          if (s.wsEarlyData.early_data_header_name) obj["ws-opts"]["early-data-header-name"] = s.wsEarlyData.early_data_header_name;
        }
      } else if (s.network === "tcp" && s.headerType === "http") {
        obj.network = "tcp";
        const httpOpts = {};
        if (s.path) {
          httpOpts.path = [s.path].filter(Boolean);
        }
        if (s.host) {
          httpOpts.headers = {
            Host: Array.isArray(s.host) ? s.host : [s.host]
          };
        }
        obj["http-opts"] = httpOpts;
      } else {
        obj.network = "tcp";
      }
    };
    if (bean.proto === "vmess") {
      const p = { ...base, type: "vmess", uuid: bean.auth.uuid, cipher: bean.auth.security || "auto", alterId: 0 };
      applyTls(p);
      applyNetwork(p);
      applyPacketEncoding(p);
      applyCommon(p);
      return p;
    }
    if (bean.proto === "vless") {
      const p = { ...base, type: "vless", uuid: bean.auth.uuid, encryption: "none" };
      if (bean.auth.flow) p.flow = bean.auth.flow;
      if (bean.auth.flow && bean.auth.flow.includes("vision")) {
        p.udp = true;
      }
      applyTls(p);
      applyNetwork(p);
      applyPacketEncoding(p);
      applyCommon(p);
      return p;
    }
    if (bean.proto === "trojan") {
      const p = { ...base, type: "trojan", password: bean.auth.password };
      applyTls(p);
      applyNetwork(p);
      applyCommon(p);
      return p;
    }
    if (bean.proto === "ss") {
      const p = { ...base, type: "ss", cipher: bean.ss.method, password: bean.ss.password };
      if (bean.ss.plugin) {
        p.plugin = bean.ss.plugin;
        if (bean.ss.pluginOpts && typeof bean.ss.pluginOpts === "object") {
          p["plugin-opts"] = bean.ss.pluginOpts;
        }
      }
      if (bean.ss.smux && bean.ss.smux.enabled) {
        p.smux = bean.ss.smux;
      }
      applyCommon(p);
      return p;
    }
    if (bean.proto === "http") {
      const p = { ...base, type: "http" };
      if (bean.socks?.username) p.username = bean.socks.username;
      if (bean.socks?.password) p.password = bean.socks.password;
      applyTls(p);
      applyCommon(p);
      return p;
    }
    if (bean.proto === "socks") {
      if (bean.socks?.type === "socks4") {
        throw new Error("Mihomo does not support: socks4");
      }
      const p = { ...base, type: "socks5" };
      if (bean.socks?.username) p.username = bean.socks.username;
      if (bean.socks?.password) p.password = bean.socks.password;
      applyCommon(p);
      return p;
    }
    if (bean.proto === "hy2") {
      const p = { ...base, type: "hysteria2", password: bean.auth.password };
      if (bean.hysteria2?.alpn) p.alpn = bean.hysteria2.alpn.split(",").filter(Boolean);
      if (bean.hysteria2?.sni) p.sni = bean.hysteria2.sni;
      if (bean.hysteria2?.allowInsecure) p["skip-cert-verify"] = true;
      if (bean.hysteria2?.obfsPassword) {
        p.obfs = "salamander";
        p["obfs-password"] = bean.hysteria2.obfsPassword;
      }
      if (bean.hysteria2?.hopInterval) {
        const hi = String(bean.hysteria2.hopInterval).trim();
        const range = hi.match(/^(\d+)\s*-\s*(\d+)$/);
        if (range && range[1] && range[2]) {
          p["hop-interval"] = `${range[1]}-${range[2]}`;
        } else {
          const m = hi.match(/^(\d+)/);
          if (m && m[1]) {
            p["hop-interval"] = parseInt(m[1], 10);
          }
        }
      }
      if (bean.hysteria2?.bbrProfile) p["bbr-profile"] = bean.hysteria2.bbrProfile;
      applyCommon(p);
      return p;
    }
    if (bean.proto === "tuic") {
      const p = { ...base, type: "tuic" };
      if (bean.tuic?.token) {
        p.token = bean.tuic.token;
      } else {
        if (bean.auth?.uuid) p.uuid = bean.auth.uuid;
        if (bean.auth?.password) p.password = bean.auth.password;
      }
      if (bean.tuic?.alpn) p.alpn = bean.tuic.alpn.split(",").filter(Boolean);
      if (bean.tuic?.sni) p.sni = bean.tuic.sni;
      if (bean.tuic?.allowInsecure) p["skip-cert-verify"] = true;
      if (bean.tuic?.congestion_control) p["congestion-controller"] = bean.tuic.congestion_control;
      if (bean.tuic?.bbr_profile) p["bbr-profile"] = bean.tuic.bbr_profile;
      if (bean.tuic?.udp_relay_mode) p["udp-relay-mode"] = bean.tuic.udp_relay_mode;
      if (bean.tuic?.disableSni) p["disable-sni"] = true;
      if (bean.tuic?.heartbeat) {
        const hb = String(bean.tuic.heartbeat).trim();
        p["heartbeat-interval"] = /^\d+$/.test(hb) ? parseInt(hb, 10) : hb;
      }
      if (bean.tuic?.requestTimeout) {
        const rt = String(bean.tuic.requestTimeout).trim();
        p["request-timeout"] = /^\d+$/.test(rt) ? parseInt(rt, 10) : rt;
      }
      if (bean.tuic?.reduceRtt) p["reduce-rtt"] = true;
      applyCommon(p);
      return p;
    }
    if (bean.proto === "wireguard") {
      const wg = bean.wireguard || {};
      const peers = Array.isArray(wg.peers) ? wg.peers : [];
      const hasPeers = peers.length > 0;
      const mapPeer = (peer) => {
        if (!peer || typeof peer !== "object") return null;
        const out = { server: peer.server, port: peer.port };
        if (peer.publicKey) out["public-key"] = peer.publicKey;
        if (peer.preSharedKey) out["pre-shared-key"] = peer.preSharedKey;
        if (Array.isArray(peer.allowedIPs) && peer.allowedIPs.length) out["allowed-ips"] = peer.allowedIPs;
        if (peer.reserved !== void 0) out.reserved = peer.reserved;
        return out;
      };
      const p = {
        name: bean.name || computeTag(bean, /* @__PURE__ */ new Set()),
        type: "wireguard",
        server: bean.host,
        port: bean.port,
        "private-key": wg.privateKey,
        udp: true
      };
      if (wg.ip) p.ip = wg.ip;
      if (wg.ipv6) p.ipv6 = wg.ipv6;
      if (wg.publicKey) p["public-key"] = wg.publicKey;
      if (wg.preSharedKey) p["pre-shared-key"] = wg.preSharedKey;
      if (Array.isArray(wg.allowedIPs) && wg.allowedIPs.length) p["allowed-ips"] = wg.allowedIPs;
      if (Number.isFinite(wg.mtu)) p.mtu = wg.mtu;
      if (Number.isFinite(wg.persistentKeepalive) && wg.persistentKeepalive > 0) p["persistent-keepalive"] = wg.persistentKeepalive;
      if (wg.reserved !== void 0) p.reserved = wg.reserved;
      if (hasPeers) p.peers = peers.map(mapPeer).filter(Boolean);
      if (wg["amnezia-wg-option"] && typeof wg["amnezia-wg-option"] === "object") {
        p["amnezia-wg-option"] = wg["amnezia-wg-option"];
      }
      applyCommon(p);
      return p;
    }
    if (bean.proto === "masque") {
      const mq = bean.masque || {};
      const p = {
        ...base,
        type: "masque"
      };
      if (mq.privateKey) p["private-key"] = mq.privateKey;
      if (mq.publicKey) p["public-key"] = mq.publicKey;
      if (mq.ip) p.ip = mq.ip;
      if (mq.ipv6) p.ipv6 = mq.ipv6;
      if (mq.uri) p.uri = mq.uri;
      if (mq.sni) p.sni = mq.sni;
      if (mq.network) p.network = mq.network;
      if (Number.isFinite(mq.mtu) && mq.mtu > 0) p.mtu = mq.mtu;
      if (mq.udp === true) p.udp = true;
      if (mq.congestionController) p["congestion-controller"] = mq.congestionController;
      if (mq.bbrProfile) p["bbr-profile"] = mq.bbrProfile;
      if (Number.isFinite(mq.cwnd) && mq.cwnd > 0) p.cwnd = mq.cwnd;
      if (mq.remoteDnsResolve) p["remote-dns-resolve"] = true;
      if (Array.isArray(mq.dns) && mq.dns.length) p.dns = mq.dns;
      applyCommon(p);
      return p;
    }
    if (bean.proto === "mieru") {
      const mieru = bean.mieru || {};
      const p = {
        name: bean.name || computeTag(bean, /* @__PURE__ */ new Set()),
        type: "mieru",
        server: bean.host,
        transport: mieru.transport || "TCP",
        username: mieru.username,
        password: mieru.password
      };
      if (mieru.server_ports) p["port-range"] = mieru.server_ports;
      else p.port = bean.port;
      if (mieru.multiplexing) p.multiplexing = mieru.multiplexing;
      if (mieru.handshake_mode) p["handshake-mode"] = mieru.handshake_mode;
      if (mieru.traffic_pattern) p["traffic-pattern"] = mieru.traffic_pattern;
      applyCommon(p);
      return p;
    }
    if (bean.proto === "trusttunnel") {
      const tt = bean.trusttunnel || {};
      const p = {
        ...base,
        type: "trusttunnel",
        username: tt.username,
        password: tt.password
      };
      if (s.sni) p.sni = s.sni;
      if (s.alpn && s.alpn.length) p.alpn = s.alpn;
      if (s.allowInsecure) p["skip-cert-verify"] = true;
      if (s.fp) p["client-fingerprint"] = s.fp;
      if (tt.fingerprint) p.fingerprint = tt.fingerprint;
      if (tt.certificate) p.certificate = tt.certificate;
      if (tt.privateKey) p["private-key"] = tt.privateKey;
      const echConfig = (s.ech?.config || s.ech?.configList || "").trim();
      const echQueryServerName = (s.ech?.queryServerName || "").trim();
      if (echConfig || echQueryServerName) {
        p["ech-opts"] = { enable: true };
        if (echConfig) p["ech-opts"].config = echConfig;
        if (echQueryServerName) p["ech-opts"]["query-server-name"] = echQueryServerName;
      }
      if (tt.healthCheck) p["health-check"] = true;
      if (tt.quic) p.quic = true;
      if (tt.congestionController) p["congestion-controller"] = tt.congestionController;
      if (tt.bbrProfile) p["bbr-profile"] = tt.bbrProfile;
      if (Number.isFinite(tt.cwnd) && tt.cwnd > 0) p.cwnd = tt.cwnd;
      if (Number.isFinite(tt.maxConnections) && tt.maxConnections > 0) p["max-connections"] = tt.maxConnections;
      if (Number.isFinite(tt.minStreams) && tt.minStreams >= 0) p["min-streams"] = tt.minStreams;
      if (Number.isFinite(tt.maxStreams) && tt.maxStreams >= 0) p["max-streams"] = tt.maxStreams;
      applyCommon(p);
      return p;
    }
    throw new Error("Not supported by Mihomo: " + bean.proto);
  }
  function deduplicateProxies(beans) {
    const toKeyPart = (v) => {
      if (v === null || v === void 0) return "";
      if (Array.isArray(v)) return v.map(toKeyPart).join(",");
      return String(v);
    };
    const stableObjectKey = (obj) => {
      if (!obj || typeof obj !== "object") return "";
      const keys = Object.keys(obj).sort();
      return keys.map((k) => `${k}=${toKeyPart(obj[k])}`).join("&");
    };
    const wireguardExtraKey = (wg) => {
      const peers = Array.isArray(wg?.peers) ? wg.peers : [];
      const peersKey = peers.map((p) => {
        const allowed = Array.isArray(p?.allowedIPs) ? p.allowedIPs.map(toKeyPart).join(",") : "";
        const reserved = p && p.reserved !== void 0 ? toKeyPart(p.reserved) : "";
        return [
          toKeyPart(p?.server),
          toKeyPart(p?.port),
          toKeyPart(p?.publicKey),
          toKeyPart(p?.preSharedKey),
          allowed,
          reserved
        ].join("|");
      }).join(";");
      const dns = Array.isArray(wg?.dns) ? wg.dns.map(toKeyPart).join(",") : "";
      const allowedIPs = Array.isArray(wg?.allowedIPs) ? wg.allowedIPs.map(toKeyPart).join(",") : "";
      return [
        `pk=${toKeyPart(wg?.privateKey)}`,
        `pub=${toKeyPart(wg?.publicKey)}`,
        `psk=${toKeyPart(wg?.preSharedKey)}`,
        `ip=${toKeyPart(wg?.ip)}`,
        `ipv6=${toKeyPart(wg?.ipv6)}`,
        `allowed=${allowedIPs}`,
        `res=${toKeyPart(wg?.reserved)}`,
        `mtu=${toKeyPart(wg?.mtu)}`,
        `keepalive=${toKeyPart(wg?.persistentKeepalive)}`,
        `udp=${toKeyPart(wg?.udp)}`,
        `remoteDnsResolve=${toKeyPart(wg?.remoteDnsResolve)}`,
        `dns=${dns}`,
        `refreshServerIPInterval=${toKeyPart(wg?.refreshServerIPInterval)}`,
        `workers=${toKeyPart(wg?.workers)}`,
        `awg=${stableObjectKey(wg?.["amnezia-wg-option"])}`,
        `peers=${peersKey}`
      ].join("&");
    };
    const seen = /* @__PURE__ */ new Set();
    return beans.filter((b) => {
      const auth = b.auth?.uuid || b.auth?.password || b.ss?.password || b.socks?.username || "";
      const network = b.stream?.network || "tcp";
      const security = b.stream?.security || "";
      const flow = b.auth?.flow || "";
      const pqv = b.stream?.reality?.pqv || "";
      const pqvKey = pqv ? pqv.substring(0, 50) : "";
      let extra = "";
      if (b.proto === "wireguard") {
        extra = wireguardExtraKey(b.wireguard || {});
      }
      const key = `${b.proto}|${b.host}|${b.port}|${auth}|${network}|${security}|${flow}|${pqvKey}|${extra}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function buildMihomoConfig(beans, opts) {
    const urlTest = getUrlTest(opts);
    const urlTestExpectedStatus = getUrlTestExpectedStatus(opts);
    const dedupedBeans = deduplicateProxies(beans);
    const proxies = dedupedBeans.map((b) => buildMihomoProxy(b));
    const used = /* @__PURE__ */ new Set();
    for (const p of proxies) {
      let base = (p.name || "proxy").toString();
      if (!base.trim()) base = "proxy";
      let name = base;
      let i = 2;
      while (used.has(name)) {
        name = `${base}-${i++}`;
      }
      p.name = name;
      used.add(name);
    }
    const names = proxies.map((p) => p.name);
    const usePerProxyListeners = isPerProxyListenerMode(opts);
    const usePerProxyPort = !!(opts && opts.perProxyPort);
    const addSocks = !opts || opts.addSocks !== false;
    const groups = [];
    if (usePerProxyListeners) {
      proxies.forEach((p) => {
        attachPerProxySelectGroup(groups, p);
      });
      const groupNames = proxies.map((p) => getPerProxyGroupName(p.name));
      groups.push({
        name: GLOBAL_GROUP_NAME,
        type: "select",
        proxies: groupNames.length > 0 ? [...groupNames, "REJECT"] : ["REJECT"]
      });
    } else {
      if (names.length > 1) {
        groups.push({
          name: FASTEST_GROUP_NAME,
          type: "url-test",
          proxies: names,
          url: urlTest,
          interval: PROXY_FETCH_INTERVAL,
          "expected-status": urlTestExpectedStatus
        });
        groups.push({
          name: GLOBAL_GROUP_NAME,
          type: "select",
          proxies: uniqueTargets(FASTEST_GROUP_NAME, names, "REJECT")
        });
      } else {
        const only = names[0] || "REJECT";
        groups.push({
          name: GLOBAL_GROUP_NAME,
          type: "select",
          proxies: [only, "REJECT"]
        });
      }
    }
    const basePort = opts && opts.basePort || 7890;
    const listeners = [];
    if (addSocks && usePerProxyPort && proxies.length > 0) {
      for (let i = 0; i < proxies.length; i++) {
        const port = basePort + i;
        const targetGroup = usePerProxyListeners ? getPerProxyGroupName(proxies[i].name) : proxies[i].name;
        listeners.push({
          name: `socks-${proxies[i].name}`,
          type: "socks",
          port,
          proxy: targetGroup
        });
      }
    }
    const config = {
      "allow-lan": false,
      mode: "rule",
      "log-level": "info",
      proxies,
      "proxy-groups": groups,
      rules: [`MATCH,${GLOBAL_GROUP_NAME}`]
    };
    if (addSocks && !usePerProxyPort) {
      config["mixed-port"] = basePort;
    } else if (listeners.length > 0) {
      config.listeners = listeners;
    }
    return config;
  }
  function buildMihomoSubscriptionConfig(subscriptionUrls, extraBeans, opts) {
    const urlTest = getUrlTest(opts);
    const urlTestExpectedStatus = getUrlTestExpectedStatus(opts);
    if (!Array.isArray(subscriptionUrls) || subscriptionUrls.length === 0) {
      throw new Error("At least one subscription URL is required");
    }
    const providers = {};
    const providerNames = [];
    const usedProviderNames = /* @__PURE__ */ new Set();
    subscriptionUrls.forEach((url, index) => {
      const providerName = computeProviderName(url, index, subscriptionUrls.length, usedProviderNames);
      providers[providerName] = {
        type: "http",
        header: {
          "x-hwid": [generateSecretHex32()]
        },
        url,
        interval: SUB_REFRESH_INTERVAL,
        __comments: {
          interval: "Subscription refresh interval"
        },
        "health-check": {
          enable: true,
          interval: PROXY_FETCH_INTERVAL,
          url: urlTest,
          "expected-status": urlTestExpectedStatus,
          __comments: {
            interval: "Health-check interval"
          }
        }
      };
      providerNames.push(providerName);
    });
    const usePerProxyListeners = isPerProxyListenerMode(opts);
    const usePerProxyPort = !!(opts && opts.perProxyPort);
    const groups = [];
    if (!usePerProxyListeners) {
      groups.push({
        name: FASTEST_GROUP_NAME,
        type: "url-test",
        use: providerNames,
        url: urlTest,
        interval: PROXY_FETCH_INTERVAL,
        "expected-status": urlTestExpectedStatus,
        tolerance: 50,
        __comments: {
          interval: "Latency probe interval (seconds)",
          tolerance: "Switch threshold (ms)"
        }
      });
    }
    if (usePerProxyListeners || usePerProxyPort) {
      providerNames.forEach((providerName) => {
        groups.push({
          name: `SUB-${providerName}`,
          type: "select",
          use: [providerName]
        });
      });
    }
    const addSocks = !opts || opts.addSocks !== false;
    const fastestGroup = !usePerProxyListeners ? groups.find((g) => g && g.name === FASTEST_GROUP_NAME && g.type === "url-test") : null;
    const extraProxies = [];
    if (Array.isArray(extraBeans) && extraBeans.length > 0) {
      extraBeans.forEach((bean) => {
        validateBean(bean);
        const p = buildMihomoProxy(bean);
        extraProxies.push(p);
        if (usePerProxyListeners) {
          attachPerProxySelectGroup(groups, p);
        } else {
          if (fastestGroup) {
            if (!Array.isArray(fastestGroup.proxies)) fastestGroup.proxies = [];
            if (!fastestGroup.proxies.includes(p.name)) fastestGroup.proxies.push(p.name);
          }
        }
      });
    }
    if (usePerProxyListeners) {
      const globalTargets = providerNames.map((providerName) => `SUB-${providerName}`);
      extraProxies.forEach((p) => {
        const targetGroup = getPerProxyGroupName(p.name);
        if (targetGroup) globalTargets.push(targetGroup);
      });
      groups.push({
        name: GLOBAL_GROUP_NAME,
        type: "select",
        proxies: globalTargets.length > 0 ? [...globalTargets, "REJECT"] : ["REJECT"]
      });
    } else {
      const fastestTargets = fastestGroup && Array.isArray(fastestGroup.proxies) ? [...fastestGroup.proxies] : [];
      groups.push({
        name: GLOBAL_GROUP_NAME,
        type: "select",
        proxies: uniqueTargets(FASTEST_GROUP_NAME, fastestTargets, "REJECT"),
        use: providerNames
      });
    }
    const basePort = opts && opts.basePort || 7890;
    const listeners = [];
    if (addSocks && usePerProxyPort) {
      const buildSocksListener = (name, proxy, port) => ({
        name: `socks-${name}`,
        type: "socks",
        port,
        proxy
      });
      let portIdx = 0;
      providerNames.forEach((providerName) => {
        listeners.push(buildSocksListener(`SUB-${providerName}`, `SUB-${providerName}`, basePort + portIdx++));
      });
      extraProxies.forEach((p) => {
        const targetGroup = getPerProxyGroupName(p.name);
        listeners.push(buildSocksListener(p.name, targetGroup, basePort + portIdx++));
      });
    }
    const rules = [`MATCH,${GLOBAL_GROUP_NAME}`];
    return { providers, groups, rules, proxies: extraProxies, listeners };
  }

  // src/core/yaml.js
  function toYamlScalar(value, key) {
    if (value === null || value === void 0) return "";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return String(value);
    const s = String(value);
    if (key === "grpc-service-name") {
      return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }
    if (/^[A-Za-z0-9_.:@#\-]+$/.test(s)) return s;
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  function toYAML(obj, indent = 0) {
    const space = "  ".repeat(indent);
    if (Array.isArray(obj)) {
      return obj.map((item) => {
        if (item && typeof item === "object") {
          const body = toYAML(item, indent + 1);
          const lines = body.split("\n");
          const indentPrefix = "  ".repeat(indent + 1);
          const firstLine = (lines[0] || "").replace(new RegExp("^" + indentPrefix), "");
          const rest = lines.slice(1).join("\n");
          return space + "- " + firstLine + (rest ? "\n" + rest : "");
        }
        return space + "- " + toYamlScalar(item, null);
      }).join("\n");
    }
    if (obj && typeof obj === "object") {
      const lines = [];
      const comments = obj.__comments && typeof obj.__comments === "object" ? obj.__comments : null;
      for (const [k, v] of Object.entries(obj)) {
        if (v === void 0) continue;
        if (k === "__comments") continue;
        if (v && typeof v === "object") {
          const child = toYAML(v, indent + 1);
          lines.push(space + k + ":");
          if (child) {
            lines.push(child);
          }
        } else {
          lines.push(space + k + ": " + toYamlScalar(v, k));
          if (comments && typeof comments[k] === "string" && comments[k].trim()) {
            lines.push(space + "# " + comments[k].trim());
          }
        }
      }
      return lines.join("\n");
    }
    return space + toYamlScalar(obj, null);
  }
  function upsertSection(lines, key, sectionYaml) {
    const findSection = () => {
      const start2 = lines.findIndex((l) => new RegExp("^" + key + "\\s*:\\s*$", "i").test(l));
      if (start2 === -1) return { start: -1, end: -1 };
      let end2 = start2 + 1;
      while (end2 < lines.length) {
        if (/^[^\s#][^:]*:\s*/.test(lines[end2])) break;
        end2++;
      }
      return { start: start2, end: end2 };
    };
    const { start, end } = findSection();
    const inject = [
      key + ":",
      ...toYAML(sectionYaml, 1).split("\n"),
      ""
    ];
    if (start === -1) {
      if (lines.length && lines.at(-1) !== "") lines.push("");
      lines.push(...inject);
    } else {
      lines.splice(start, end - start, ...inject);
    }
  }
  function overlayMihomoYaml(baseYamlText, proxies, groups, providers, rules, listeners) {
    const text = (baseYamlText || "").replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    if (Array.isArray(proxies) && proxies.length > 0) {
      upsertSection(lines, "proxies", proxies);
    }
    if (Array.isArray(groups) && groups.length > 0) {
      upsertSection(lines, "proxy-groups", groups);
    }
    if (providers && typeof providers === "object" && Object.keys(providers).length > 0) {
      upsertSection(lines, "proxy-providers", providers);
    }
    if (Array.isArray(rules) && rules.length > 0) {
      upsertSection(lines, "rules", rules);
    }
    if (Array.isArray(listeners) && listeners.length > 0) {
      upsertSection(lines, "listeners", listeners);
      const hasSocksListener = listeners.some(
        (l) => l && typeof l === "object" && String(l.type || "").toLowerCase() === "socks"
      );
      if (hasSocksListener) {
        const mixedPortIndex = lines.findIndex((l) => /^mixed-port\s*:/i.test(l));
        if (mixedPortIndex !== -1) {
          lines.splice(mixedPortIndex, 1);
        }
      }
    }
    return lines.join("\n");
  }
  var MIHOMO_DEFAULT_TEMPLATE = [
    "mixed-port: 7890",
    "allow-lan: false",
    "tcp-concurrent: true",
    "mode: rule",
    "log-level: info",
    "ipv6: false",
    "unified-delay: true",
    "profile:",
    "  store-selected: true",
    "  store-fake-ip: true",
    "",
    "proxy-groups:",
    "rules:",
    '  - "MATCH,GLOBAL"'
  ].join("\n");
  function buildMihomoYaml(proxies, groups, providers, rules, listeners, opts) {
    opts = opts || {};
    const addSocks = opts.addSocks !== false;
    const webUI = opts.webUI === true;
    const tunOpt = opts.tun;
    const perProxyGroupName = (name) => `\u{1F512} ${name}`;
    let template = MIHOMO_DEFAULT_TEMPLATE;
    if (!addSocks) {
      template = template.split("\n").filter((line) => !/^mixed-port\s*:/i.test(line)).join("\n");
    }
    if (webUI) {
      const lines = template.split("\n");
      const ipv6Index = lines.findIndex((l) => /^ipv6\s*:/i.test(l));
      if (ipv6Index !== -1) {
        lines.splice(
          ipv6Index + 1,
          0,
          "external-controller: 0.0.0.0:9090",
          "external-ui: ui",
          "external-ui-url: https://github.com/MetaCubeX/metacubexd/releases/latest/download/compressed-dist.tgz",
          "secret: "
        );
        template = lines.join("\n");
      }
    }
    if (tunOpt) {
      const lines = template.split("\n");
      const proxiesIndex = lines.findIndex((l) => /^proxy-groups\s*:/i.test(l));
      const mode = tunOpt && typeof tunOpt === "object" && tunOpt.mode ? String(tunOpt.mode) : "tun";
      if (mode === "listeners") {
        const buildTunListener = (idx, proxyName) => {
          const offset = idx * 4 + 1;
          const oct3 = Math.floor(offset / 256);
          const oct4 = offset % 256;
          const inet4 = `198.19.${oct3}.${oct4}/30`;
          const out = {
            name: `mihomo-tun-${idx + 1}`,
            type: "tun",
            device: `mitun${idx}`,
            stack: "gvisor",
            "auto-route": false,
            "auto-detect-interface": false,
            "inet4-address": [inet4]
          };
          if (proxyName) out.proxy = proxyName;
          return out;
        };
        const tunListeners = [];
        const proxyList = Array.isArray(proxies) ? proxies : [];
        const providerKeys = providers && typeof providers === "object" ? Object.keys(providers) : [];
        const hasGroup = (name) => Array.isArray(groups) && groups.some((g) => g && g.name === name);
        const targets = [];
        if (providerKeys.length > 0) {
          providerKeys.forEach((pn) => {
            const groupName = `SUB-${pn}`;
            if (pn && hasGroup(groupName)) {
              targets.push(groupName);
            }
          });
          if (targets.length === 0 && providerKeys.length === 1) {
            const fastestGroup = Array.isArray(groups) ? groups.find((g) => g?.type === "url-test" && Array.isArray(g.use)) : null;
            const name = fastestGroup && fastestGroup.name ? fastestGroup.name : "PROXY";
            targets.push(name);
          }
          proxyList.forEach((p) => {
            const proxyName = p?.name;
            const targetName = proxyName && hasGroup(perProxyGroupName(proxyName)) ? perProxyGroupName(proxyName) : proxyName;
            if (targetName) targets.push(targetName);
          });
        } else {
          proxyList.forEach((p) => {
            const proxyName = p?.name;
            const targetName = proxyName && hasGroup(perProxyGroupName(proxyName)) ? perProxyGroupName(proxyName) : proxyName;
            if (targetName) targets.push(targetName);
          });
        }
        targets.forEach((name, idx) => {
          tunListeners.push(buildTunListener(idx, name));
        });
        const merged = Array.isArray(listeners) ? listeners.slice() : [];
        merged.push(...tunListeners);
        listeners = merged;
      } else {
        const tun = {
          enable: true,
          stack: "gvisor",
          "auto-route": false,
          "auto-detect-interface": true,
          device: "mitun0"
        };
        const inject = [
          "tun:",
          ...toYAML(tun, 1).split("\n"),
          ""
        ];
        if (proxiesIndex !== -1) {
          lines.splice(proxiesIndex, 0, ...inject);
        } else {
          lines.push(...inject);
        }
        template = lines.join("\n");
      }
    }
    return overlayMihomoYaml(template, proxies, groups, providers, rules, listeners);
  }

  // src/core/subscription.js
  function buildSchemesRegex(flags) {
    const escaped = SUPPORTED_SCHEMES.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    return new RegExp("(?:" + escaped + ")://", flags || "i");
  }
  function looksLikeLinksList(text) {
    const t = (text || "").trim();
    if (!t) return false;
    const rx = buildSchemesRegex("i");
    return rx.test(t);
  }
  function looksLikeJsonContainer(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    return t.startsWith("{") && t.endsWith("}") || t.startsWith("[") && t.endsWith("]");
  }
  function normalizeSubscriptionBody(raw) {
    const t = (raw || "").trim();
    if (!t) return "";
    const tryDecode = (s) => {
      const input = String(s || "").trim();
      if (!input) return "";
      const candidates = [];
      const push = (x) => {
        const v = String(x || "");
        if (!v) return;
        if (!candidates.includes(v)) candidates.push(v);
      };
      push(input);
      const m = input.match(/^[A-Za-z0-9+/=_-]+/);
      if (m) push(m[0]);
      const lastEq = input.lastIndexOf("=");
      if (lastEq !== -1 && lastEq < input.length - 1) {
        push(input.slice(0, lastEq + 1));
      }
      for (const cand of candidates) {
        const out = decodeBase64Url(cand);
        if (out) return out;
      }
      return "";
    };
    let body = t;
    const dec1 = tryDecode(t);
    if (dec1 && (looksLikeLinksList(dec1) || dec1.includes("\n") || looksLikeJsonContainer(dec1))) body = dec1;
    if (!looksLikeLinksList(body)) {
      const dec2 = tryDecode(body);
      if (dec2 && (looksLikeLinksList(dec2) || looksLikeJsonContainer(dec2))) body = dec2;
    }
    return body.replace(/\r\n/g, "\n");
  }
  function isLikelyHtml(s) {
    const t = (s || "").trim().slice(0, 2e3).toLowerCase();
    if (!t) return false;
    return t.startsWith("<!doctype html") || t.includes("<html") || t.includes("<head") || t.includes("<body");
  }
  function parseMetaRefresh(html) {
    const s = html || "";
    const m = s.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*\d+\s*;\s*url=([^"'>\s]+)["']?[^>]*>/i);
    return m ? m[1] : "";
  }
  function extractLinksFromHtml(html) {
    const out = [];
    const addIf = (val) => {
      const v = (val || "").trim();
      if (v) out.push(v);
    };
    try {
      if (typeof DOMParser !== "undefined") {
        const dp = new DOMParser();
        const doc = dp.parseFromString(html, "text/html");
        const anchors = doc.querySelectorAll("a[href]");
        anchors.forEach((a) => addIf(a.getAttribute("href")));
        const text = doc.body ? doc.body.textContent || "" : "";
        const re = new RegExp(buildSchemesRegex().source + `[^\\s<>"']+`, "ig");
        let m;
        while ((m = re.exec(text)) !== null) addIf(m[0]);
      } else {
        const reHref = /href=["']([^"']+)["']/ig;
        let m1;
        while ((m1 = reHref.exec(html)) !== null) addIf(m1[1]);
        const re = new RegExp(buildSchemesRegex().source + `[^\\s<>"']+`, "ig");
        let m2;
        while ((m2 = re.exec(html)) !== null) addIf(m2[0]);
      }
    } catch {
    }
    return out;
  }
  function filterSubscriptionLinks(items) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const re = buildSchemesRegex("i");
    for (const item of Array.isArray(items) ? items : []) {
      const link = String(item || "").trim();
      if (!link || seen.has(link)) continue;
      if (!re.test(link)) continue;
      seen.add(link);
      out.push(link);
    }
    return out;
  }
  function extractLinksFromText(raw) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    const text = String(raw || "").replace(/\\\//g, "/");
    const re = new RegExp(buildSchemesRegex().source + "[^\\s<>\"'`,\\\\]+", "ig");
    let m;
    while ((m = re.exec(text)) !== null) {
      const link = String(m[0] || "").trim();
      if (!link || seen.has(link)) continue;
      seen.add(link);
      out.push(link);
    }
    return out;
  }
  function extractLinksFromEmbeddedPayload(html) {
    const candidates = [];
    const addCandidate = (val) => {
      const s = String(val || "").trim();
      if (!s || s.length < 64 || s.length > 2e6) return;
      if (/[^A-Za-z0-9+/=_-]/.test(s)) return;
      if (!candidates.includes(s)) candidates.push(s);
    };
    const addLinksFrom = (source, out2, seen2) => {
      const links = extractLinksFromText(source);
      for (const link of links) {
        if (seen2.has(link)) continue;
        seen2.add(link);
        out2.push(link);
      }
    };
    const htmlText = String(html || "");
    let m;
    const reDataAttr = /data-[\w:-]+=["']([^"']{64,})["']/ig;
    while ((m = reDataAttr.exec(htmlText)) !== null) addCandidate(m[1]);
    const reAtob = /atob\((['"])([A-Za-z0-9+/=_-]{64,})\1\)/ig;
    while ((m = reAtob.exec(htmlText)) !== null) addCandidate(m[2]);
    const reQuotedB64 = /['"]([A-Za-z0-9+/=_-]{160,})['"]/g;
    while ((m = reQuotedB64.exec(htmlText)) !== null) addCandidate(m[1]);
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      const decoded = decodeBase64Url(candidate) || "";
      if (!decoded) continue;
      addLinksFrom(decoded, out, seen);
      const nested = normalizeSubscriptionBody(decoded);
      if (nested && nested !== decoded) addLinksFrom(nested, out, seen);
    }
    return out;
  }
  function httpReason(status) {
    const map = {
      400: "Bad Request",
      403: "Forbidden",
      404: "Not Found",
      408: "Request Timeout",
      429: "Too Many Requests",
      500: "Internal Server Error",
      502: "Bad Gateway",
      503: "Service Unavailable",
      504: "Gateway Timeout"
    };
    return map[status] || "";
  }
  async function fetchSubscription(url) {
    if (typeof fetch !== "function") throw new Error("Fetch API not available");
    const allowedSchemes = new Set(SUPPORTED_SCHEMES.filter((s) => s !== "http" && s !== "https"));
    const splitLines2 = (text) => (text || "").split(/\n/).map((s) => s.trim()).filter(Boolean);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
    function hasRealSubscriptionLinks(text) {
      const lines2 = splitLines2(text);
      if (!lines2.length) return false;
      return lines2.some((line) => {
        const scheme = (line.split(":", 1)[0] || "").toLowerCase();
        return allowedSchemes.has(scheme);
      });
    }
    async function tryFetch(u) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SUB_FETCH_TIMEOUT);
      try {
        const headers = new Headers(FETCH_INIT && FETCH_INIT.headers ? FETCH_INIT.headers : {});
        if (!headers.has("Accept")) headers.set("Accept", "text/plain, */*");
        if (!isBrowser) {
          if (/github\.com|raw\.githubusercontent\.com/i.test(u)) {
            headers.set("Referer", "https://github.com/");
          }
        }
        const resp = await fetch(u, Object.assign({}, FETCH_INIT, { headers, signal: controller.signal }));
        if (!resp.ok) {
          const reason = resp.statusText || httpReason(resp.status) || "";
          const label = "HTTP " + resp.status + (reason ? " " + reason : "");
          return { error: new Error(label) };
        }
        const text = await resp.text();
        return { text };
      } catch (e) {
        return { error: e };
      } finally {
        clearTimeout(timeoutId);
      }
    }
    function classifyError(err) {
      const msg = err && err.message ? err.message : "";
      const http = msg.match(/^HTTP\s+(\d+)(?:\s+(.+))?/);
      if (http) {
        const code = parseInt(http[1], 10);
        const reason = (http[2] || "").trim();
        if (code === 403) return "403 Forbidden (upstream blocked subscription fetch; retry usually helps)";
        if (code === 429) return "429 Too Many Requests (rate-limited; retry later)";
        return String(code) + (reason ? " " + reason : "");
      }
      if (msg.includes("aborted") || msg.includes("abort") || msg.includes("timeout")) {
        return "Request timeout (15s)";
      }
      if (msg.includes("NetworkError") || msg.includes("Failed to fetch") || msg.includes("Network request failed")) {
        return "Network error, check connection";
      }
      if (msg.includes("Subscription returned no valid links")) {
        return "Subscription returned no valid links";
      }
      return "CORS error, using fallback proxy";
    }
    async function fetchWithFallback(u, depth) {
      if (depth > MAX_SUB_REDIRECTS) throw new Error("Too many redirects");
      const handleResponse = async (text) => {
        if (!text || typeof text !== "string") return null;
        let probe = text;
        const resolveHtmlProbe = async () => {
          if (!isLikelyHtml(probe)) return null;
          const redir = parseMetaRefresh(probe);
          if (redir) return await fetchWithFallback(redir, depth + 1);
          const extracted = filterSubscriptionLinks(extractLinksFromHtml(probe));
          if (extracted.length) return extracted.join("\n");
          const embedded = extractLinksFromEmbeddedPayload(probe);
          if (embedded.length) return embedded.join("\n");
          return null;
        };
        const htmlPass1 = await resolveHtmlProbe();
        if (htmlPass1) return htmlPass1;
        const dec = normalizeSubscriptionBody(probe);
        if (dec) probe = dec;
        const htmlPass2 = await resolveHtmlProbe();
        if (htmlPass2) return htmlPass2;
        if (hasRealSubscriptionLinks(probe)) return probe;
        const extractedGeneric = extractLinksFromText(probe);
        if (extractedGeneric.length) return extractedGeneric.join("\n");
        const maybeUrl = splitLines2(probe);
        if (maybeUrl.length === 1 && isHttpUrl(maybeUrl[0])) return maybeUrl[0];
        return null;
      };
      const consumeFetchResult = async (result) => {
        if (result.error || typeof result.text !== "string") return null;
        return await handleResponse(result.text);
      };
      const direct = isHttpUrl(u) ? await tryFetch(u) : { error: new Error("not-http") };
      const directResolved = await consumeFetchResult(direct);
      if (directResolved) return directResolved;
      if (!direct.error) {
        direct.error = new Error("Subscription returned no valid links");
      }
      if (!isBrowser) {
        throw new Error(classifyError(direct.error || new Error("Fetch failed")));
      }
      if (direct.error) {
        if (/^HTTP\s+(403|429|5\d\d)/.test(String(direct.error.message || ""))) {
          await sleep(350);
          const retry = await tryFetch(u);
          const retryResolved = await consumeFetchResult(retry);
          if (retryResolved) return retryResolved;
        }
        for (const makeUrl of PUBLIC_CORS_FALLBACKS) {
          const maxRetries = Math.max(0, Number(SUB_FALLBACK_RETRIES || 0));
          for (let retry = 0; retry <= maxRetries; retry++) {
            const result = await tryFetch(makeUrl(u));
            const resolved = await consumeFetchResult(result);
            if (resolved) return resolved;
            if (result.error && retry < maxRetries) {
              await sleep(500);
            }
          }
        }
      }
      throw new Error(classifyError(direct.error));
    }
    let body = await fetchWithFallback(url, 0);
    if (!body) throw new Error("Empty response");
    {
      const cand = body.split(/\n/).map((s) => s.trim()).filter(Boolean);
      if (cand.length === 1 && isHttpUrl(cand[0]) && !looksLikeLinksList(cand[0])) {
        body = await fetchWithFallback(cand[0], 1);
      }
    }
    if (/\bproxies\s*:/i.test(body) && !looksLikeLinksList(body)) throw new Error("Clash YAML subscription is not supported here");
    const lines = splitLines2(body);
    const filtered = lines.filter((line) => allowedSchemes.has((line.split(":", 1)[0] || "").toLowerCase()));
    return filtered.join("\n");
  }

  // src/core/wireguard.js
  function parseWireGuardConf(confText, nameHint) {
    const text = String(confText || "").replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    let section = "";
    const iface = {};
    const peers = [];
    let curPeer = null;
    const cleanLine = (ln) => {
      let s = (ln || "").trim();
      if (!s) return "";
      const hash = s.indexOf("#");
      const semi = s.indexOf(";");
      const cut = hash === -1 ? semi : semi === -1 ? hash : Math.min(hash, semi);
      if (cut !== -1) s = s.slice(0, cut).trim();
      return s;
    };
    const splitKV = (ln) => {
      const i = ln.indexOf("=");
      if (i === -1) return null;
      const k = ln.slice(0, i).trim();
      const v = ln.slice(i + 1).trim();
      if (!k) return null;
      return { k, v };
    };
    const parseCsv = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
    const parseAddrList = (v) => parseCsv(v).map((x) => x.replace(/\s+/g, "")).filter(Boolean);
    const setAwgOpt = (target, key, value) => {
      const k = String(key || "").trim().toLowerCase();
      const map = {
        jc: "jc",
        jmin: "jmin",
        jmax: "jmax",
        s1: "s1",
        s2: "s2",
        s3: "s3",
        s4: "s4",
        h1: "h1",
        h2: "h2",
        h3: "h3",
        h4: "h4",
        i1: "i1",
        i2: "i2",
        i3: "i3",
        i4: "i4",
        i5: "i5",
        j1: "j1",
        j2: "j2",
        j3: "j3",
        itime: "itime"
      };
      if (!map[k]) return false;
      if (!target["amnezia-wg-option"]) target["amnezia-wg-option"] = {};
      const outKey = map[k];
      const raw = String(value || "").trim();
      const numericKeys = /* @__PURE__ */ new Set(["jc", "jmin", "jmax", "s1", "s2", "s3", "s4", "itime"]);
      if (numericKeys.has(outKey) && /^-?\d+$/.test(raw)) {
        target["amnezia-wg-option"][outKey] = parseInt(raw, 10);
      } else {
        target["amnezia-wg-option"][outKey] = raw;
      }
      return true;
    };
    const parseReserved = (v) => {
      const s = String(v || "").trim();
      if (!s) return void 0;
      if (s.includes(",")) {
        const parts = parseCsv(s);
        const nums = parts.map((x) => /^\d+$/.test(x) ? parseInt(x, 10) : NaN).filter((n) => Number.isInteger(n) && n >= 0 && n <= 255);
        return nums.length ? nums : void 0;
      }
      return s;
    };
    for (const rawLine of lines) {
      const ln = cleanLine(rawLine);
      if (!ln) continue;
      const secMatch = ln.match(/^\[([^\]]+)\]$/);
      if (secMatch) {
        section = (secMatch[1] || "").trim().toLowerCase();
        if (section === "peer") {
          curPeer = {};
          peers.push(curPeer);
        } else {
          curPeer = null;
        }
        continue;
      }
      const kv = splitKV(ln);
      if (!kv) continue;
      const key = kv.k.trim();
      const value = kv.v;
      const keyLower = key.toLowerCase();
      if (setAwgOpt(iface, key, value)) continue;
      if (section === "interface") {
        if (keyLower === "privatekey") iface.privateKey = value;
        else if (keyLower === "address") iface.addresses = parseAddrList(value);
        else if (keyLower === "dns") iface.dns = parseCsv(value);
        else if (keyLower === "mtu") iface.mtu = /^\d+$/.test(value) ? parseInt(value, 10) : void 0;
        else if (keyLower === "name") iface.name = value;
      } else if (section === "peer" && curPeer) {
        if (keyLower === "publickey") curPeer.publicKey = value;
        else if (keyLower === "presharedkey") curPeer.preSharedKey = value;
        else if (keyLower === "allowedips") curPeer.allowedIPs = parseAddrList(value);
        else if (keyLower === "endpoint") curPeer.endpoint = value;
        else if (keyLower === "persistentkeepalive") curPeer.persistentKeepalive = /^\d+$/.test(value) ? parseInt(value, 10) : void 0;
        else if (keyLower === "reserved") {
          curPeer.reserved = parseReserved(value);
        } else {
          setAwgOpt(iface, key, value);
        }
      }
    }
    const chosenPeer = peers[0] || {};
    const { host, port } = parseAddrHostPort(chosenPeer.endpoint || "", 51820);
    const addrs = Array.isArray(iface.addresses) ? iface.addresses : [];
    const ipv4Raw = addrs.find((a) => /^(\d{1,3}\.){3}\d{1,3}(\/\d+)?$/.test(a));
    const ipv6Raw = addrs.find((a) => /:/.test(a));
    const ipv4 = ipv4Raw ? ipv4Raw.split("/")[0] : "";
    const ipv6 = ipv6Raw ? ipv6Raw.split("/")[0] : "";
    const nameBase = (iface.name || nameHint || "WireGuard").toString().trim();
    const name = nameBase ? nameBase.replace(/\.(conf|wg|awg)$/i, "") : "WireGuard";
    const wgPeers = peers.map((p) => {
      const ap = parseAddrHostPort(p.endpoint || "", 51820);
      return {
        server: ap.host,
        port: ap.port,
        publicKey: p.publicKey || "",
        preSharedKey: p.preSharedKey || "",
        allowedIPs: Array.isArray(p.allowedIPs) ? p.allowedIPs : [],
        reserved: p.reserved
      };
    }).filter((p) => p.server && p.port);
    const keepalive = peers.map((p) => p.persistentKeepalive).find((v) => Number.isFinite(v));
    const hasIpv6 = !!ipv6;
    const peer0 = wgPeers[0] || {};
    const allowed0 = Array.isArray(peer0.allowedIPs) ? peer0.allowedIPs.slice() : [];
    const allowedFiltered0 = hasIpv6 ? allowed0 : allowed0.filter((x) => !String(x || "").includes(":"));
    const peersFiltered = wgPeers.map((peer) => {
      const a = Array.isArray(peer.allowedIPs) ? peer.allowedIPs : [];
      const allowedFiltered = hasIpv6 ? a : a.filter((x) => !String(x || "").includes(":"));
      return Object.assign({}, peer, { allowedIPs: allowedFiltered });
    });
    const bean = {
      proto: "wireguard",
      name,
      host: peer0.server || host,
      port: peer0.port || port,
      ipVersion: hasIpv6 ? "" : "ipv4",
      wireguard: {
        ip: ipv4 || "",
        ipv6: ipv6 || "",
        addresses: Array.isArray(iface.addresses) ? iface.addresses.slice() : [],
        privateKey: iface.privateKey || "",
        publicKey: peer0.publicKey || (chosenPeer.publicKey || ""),
        preSharedKey: peer0.preSharedKey || (chosenPeer.preSharedKey || ""),
        allowedIPs: allowedFiltered0.length ? allowedFiltered0 : chosenPeer.allowedIPs || [],
        reserved: peer0.reserved !== void 0 ? peer0.reserved : chosenPeer.reserved,
        peers: peersFiltered.length >= 2 ? peersFiltered : void 0,
        dns: Array.isArray(iface.dns) && iface.dns.length ? iface.dns : [],
        remoteDnsResolve: Array.isArray(iface.dns) && iface.dns.length ? true : false,
        mtu: iface.mtu,
        persistentKeepalive: keepalive
      }
    };
    if (iface["amnezia-wg-option"]) {
      bean.wireguard["amnezia-wg-option"] = iface["amnezia-wg-option"];
    }
    return bean;
  }

  // src/build.js
  function assertCoreSupports(beans, core, label, options) {
    const allowed = new Set(getAllowedCoreProtocols(core, options));
    const unsupported = /* @__PURE__ */ new Set();
    for (const b of Array.isArray(beans) ? beans : []) {
      const p = b?.proto;
      if (!p) continue;
      if (!allowed.has(p)) unsupported.add(p);
    }
    if (unsupported.size) {
      throw new Error(`${label} does not support: ${Array.from(unsupported).join(", ")}`);
    }
  }
  function splitLines(raw) {
    return String(raw || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  function splitMihomoSubscriptionInput(raw) {
    const lines = splitLines(raw);
    const subUrls = [];
    const proxyLines = [];
    for (const line of lines) {
      if (/^https?:\/\//i.test(line)) {
        try {
          const u = new URL(line);
          const hasCreds = !!(u.username || u.password);
          (hasCreds ? proxyLines : subUrls).push(line);
        } catch {
          proxyLines.push(line);
        }
      } else {
        proxyLines.push(line);
      }
    }
    return { subUrls, proxyText: proxyLines.join("\n") };
  }
  function buildFromRequest(req) {
    const core = String(req?.core || "").toLowerCase();
    const input = String(req?.input || "");
    const optionsIn = req && typeof req.options === "object" && req.options ? req.options : {};
    const options = Object.assign({}, optionsIn);
    const wgBeans = Array.isArray(req?.wgBeans) ? req.wgBeans : [];
    options.urlTest = resolveUrlTest(options.urlTest);
    if (!core) throw new Error("Missing core");
    if (core !== "singbox" && core !== "xray" && core !== "mihomo") throw new Error("Invalid core: " + core);
    if (core === "singbox") {
      if (options.addTun === void 0) options.addTun = false;
      if (options.addSocks === void 0) options.addSocks = true;
      if (options.webUI === void 0) options.webUI = false;
    } else if (core === "xray") {
      if (options.addTun === void 0) options.addTun = false;
      if (options.addSocks === void 0) options.addSocks = true;
    } else if (core === "mihomo") {
      if (options.webUI === void 0) options.webUI = true;
      if (options.addTun === void 0) options.addTun = false;
      if (options.addSocks === void 0) options.addSocks = true;
    }
    const beans = input.trim() ? buildBeansFromInput(input.trim()) : [];
    const allBeans = beans.slice();
    if (wgBeans.length) allBeans.push(...wgBeans);
    if (!allBeans.length) throw new Error("No valid links or profiles provided");
    allBeans.forEach(validateBean);
    if (core === "xray" || core === "mihomo") {
      assertCoreSupports(allBeans, core, core === "xray" ? "Xray" : "Mihomo", options);
    }
    if (core === "singbox") {
      const useExtended = !!options.useExtended;
      if (!useExtended) {
        const hasExtendedOnly = allBeans.some((b) => b.proto === "mieru" || b.proto === "sdns");
        if (hasExtendedOnly) throw new Error("Enable Extended to generate Mieru/SDNS configurations");
      }
      const dnsBeans = useExtended ? allBeans.filter((b) => b.proto === "sdns") : [];
      const wgBeans2 = allBeans.filter((b) => b.proto === "wireguard");
      const outboundBeans = allBeans.filter((b) => b.proto !== "sdns" && b.proto !== "wireguard");
      const used = /* @__PURE__ */ new Set();
      const endpoints = wgBeans2.map((b) => {
        const tag = computeTag(b, used);
        return Object.assign({ tag }, buildSingBoxWireGuardEndpoint(Object.assign({}, b, { name: tag })));
      });
      const outbounds = outboundBeans.map((b) => {
        const ob = buildSingBoxOutbound(b, { useExtended: !!useExtended });
        const tag = computeTag(b, used);
        return Object.assign({ tag }, ob);
      });
      const detour = !!options.detour;
      if (detour && outbounds.length > 1) {
        const mainTag = outbounds[0].tag;
        for (let i = 1; i < outbounds.length; i++) outbounds[i].detour = mainTag;
      }
      const cfg2 = buildSingBoxConfig(outbounds, {
        addTun: !!options.addTun,
        addSocks: !!options.addSocks,
        perTunMixed: !!options.perTunMixed,
        tunName: String(options.tunName || ""),
        genClashSecret: !!options.genClashSecret,
        useExtended: !!useExtended,
        androidMode: !!options.androidMode,
        dnsBeans,
        endpoints,
        urlTest: options.urlTest
      });
      return { kind: "json", data: cfg2 };
    }
    if (core === "xray") {
      let cfg2;
      const addTun2 = !!options.addTun;
      const addSocks2 = !!options.addSocks;
      if (!addTun2 && !addSocks2) {
        throw new Error("Xray: enable at least one inbound (TUN or SOCKS5)");
      }
      if (allBeans.length === 1) {
        cfg2 = buildXrayConfig(buildXrayOutbound(allBeans[0]), { addTun: addTun2, addSocks: addSocks2, urlTest: options.urlTest });
      } else {
        const used = /* @__PURE__ */ new Set();
        const outbounds = allBeans.map((b) => {
          const ob = buildXrayOutbound(b);
          ob.tag = computeTag(b, used);
          return ob;
        });
        cfg2 = buildXrayConfig(outbounds, { enableBalancer: !!options.enableBalancer, addTun: addTun2, addSocks: addSocks2, urlTest: options.urlTest });
      }
      return { kind: "json", data: cfg2 };
    }
    const webUI = !!options.webUI;
    const addSocks = !!options.addSocks;
    const perProxyPort = !!options.perProxyPort;
    const addTun = !!options.addTun;
    if (!addTun && !addSocks) {
      throw new Error("Mihomo: enable at least one inbound (TUN or SOCKS5)");
    }
    const perProxyListeners = perProxyPort || !!options.mihomoPerProxyTun;
    const mihomoTunOpts = addTun ? { mode: options.mihomoPerProxyTun ? "listeners" : "tun" } : null;
    const subMode = !!options.mihomoSubscriptionMode;
    if (subMode) {
      const { subUrls, proxyText } = splitMihomoSubscriptionInput(input);
      if (!subUrls.length) {
        throw new Error("Provide one or more HTTP(S) URLs for Mihomo subscription (one per line)");
      }
      const extraBeans = [];
      if (proxyText.trim()) extraBeans.push(...buildBeansFromInput(proxyText));
      if (wgBeans.length) extraBeans.push(...wgBeans);
      extraBeans.forEach(validateBean);
      assertCoreSupports(extraBeans, core, "Mihomo", options);
      const cfg2 = buildMihomoSubscriptionConfig(subUrls, extraBeans, { addSocks, perProxyPort, perProxyListeners, urlTest: options.urlTest });
      const yaml2 = buildMihomoYaml(cfg2.proxies, cfg2.groups, cfg2.providers, cfg2.rules, cfg2.listeners, {
        addSocks,
        webUI,
        tun: mihomoTunOpts
      });
      return { kind: "yaml", data: yaml2 };
    }
    const outBeans = allBeans.filter((b) => b.proto !== "sdns");
    const cfg = buildMihomoConfig(outBeans, { addSocks, perProxyPort, perProxyListeners, urlTest: options.urlTest });
    const yaml = buildMihomoYaml(cfg.proxies, cfg["proxy-groups"], null, cfg.rules, cfg.listeners, {
      addSocks,
      webUI,
      tun: mihomoTunOpts
    });
    return { kind: "yaml", data: yaml };
  }

  // src/entry-web4core.js
  globalThis.web4core = Object.assign({}, globalThis.web4core || {}, {
    buildBeansFromInput,
    validateBean,
    computeTag,
    getAllowedCoreProtocols,
    URLTEST,
    URLTEST_CHOICES,
    buildSingBoxOutbound,
    buildSingBoxConfig,
    buildXrayOutbound,
    buildXrayConfig,
    buildMihomoProxy,
    buildMihomoConfig,
    buildMihomoSubscriptionConfig,
    buildMihomoYaml,
    parseWireGuardConf,
    fetchSubscription,
    buildFromRequest
  });
})();
//! parseUri 3.0.2; Steven Levithan; MIT License
