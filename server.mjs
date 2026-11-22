/**
 * OrangeDisk · 橙盘 —— 本地存储分析器
 * 零依赖：仅用 Node 内置模块 + Windows PowerShell（读取卷标 / 已安装应用）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fsp = fs.promises;
const PUBLIC = path.join(HERE, 'public');
const BASE_PORT = 7788;
const MAX_PORT = BASE_PORT + 11;
const SCAN_CONCURRENCY = 6;
const SCAN_TIMEOUT = 30_000;
const SIZE_TTL = 5 * 60_000;
const LIST_LIMIT = 5000;
const START = Date.now();
let lastHit = Date.now();
let closingSince = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const W = '\\';
const joinPath = (dir, name) => (dir.endsWith(W) ? dir + name : dir + W + name);

/* ---------- 小工具 ---------- */

const json = (res, code, data) => {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// 只接受 Windows 绝对盘符路径，避免越权到奇怪的位置
function safePath(p) {
  if (typeof p !== 'string' || !p) return null;
  if (!/^[a-zA-Z]:([\\/]|$)/.test(p)) return null;
  return path.normalize(p);
}

const HIDDEN_NAMES = new Set([
  '$recycle.bin', 'system volume information', 'recovery', 'config.msi', '$winreagent',
  'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log.tmp', 'dumpstack.log',
  'bootmgr', 'bootnxt', '$windows.~bt', '$windows.~ws', 'desktop.ini', 'thumbs.db',
  'documents and settings', 'all users', 'default user', 'application data', 'local settings',
]);
const isHiddenName = (name) => name.startsWith('.') || HIDDEN_NAMES.has(name.toLowerCase());

/* ---------- 扫描并发闸门 ---------- */

let running = 0;
const waiting = [];
function acquire() {
  if (running < SCAN_CONCURRENCY) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

/* ---------- 目录大小 ---------- */

const sizeCache = new Map(); // key: 小写路径 -> { size, files, dirs, truncated, at }

async function computeSize(root, isCancelled) {
  let size = 0;
  let files = 0;
  let dirs = 0;
  let truncated = false;
  const stack = [root];
  const deadline = Date.now() + SCAN_TIMEOUT;

  while (stack.length) {
    if (isCancelled()) throw new Error('cancelled');
    if (Date.now() > deadline) { truncated = true; break; }
    const dir = stack.pop();
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }

    const batch = [];
    for (const e of ents) {
      if (e.isSymbolicLink()) continue; // junction / symlink 一律不跟随，防止循环与重复计数
      if (e.isDirectory()) { stack.push(joinPath(dir, e.name)); dirs++; }
      else if (e.isFile()) batch.push(joinPath(dir, e.name));
    }
    for (let i = 0; i < batch.length; i += 64) {
      const chunk = batch.slice(i, i + 64);
      const stats = await Promise.all(chunk.map((f) => fsp.lstat(f).catch(() => null)));
      for (const s of stats) if (s) { size += s.size; files++; }
      if (isCancelled()) throw new Error('cancelled');
    }
    if (files > 400_000 || dirs > 80_000) { truncated = true; break; }
  }
  return { size, files, dirs, truncated };
}

async function sizeOf(target, isCancelled) {
  const key = target.toLowerCase();
  const hit = sizeCache.get(key);
  if (hit && Date.now() - hit.at < (hit.ttl || SIZE_TTL)) return { ...hit, cached: true };

  await acquire();
  try {
    if (isCancelled()) throw new Error('cancelled');
    const r = await computeSize(target, isCancelled);
    // 未统计完的结果只短暂缓存，方便稍后重试拿到完整值
    sizeCache.set(key, { ...r, at: Date.now(), ttl: r.truncated ? 90_000 : SIZE_TTL });
    return { ...r, cached: false };
  } finally {
    release();
  }
}

/* ---------- 目录列表 ---------- */

async function listDir(target) {
  let ents;
  try {
    ents = await fsp.readdir(target, { withFileTypes: true });
  } catch (e) {
    const err = new Error(e.code === 'ENOENT' ? '目录不存在' : '无法读取该目录（权限不足）');
    err.status = e.code === 'ENOENT' ? 404 : 403;
    throw err;
  }

  const truncated = ents.length > LIST_LIMIT;
  const use = truncated ? ents.slice(0, LIST_LIMIT) : ents;

  const stats = await mapLimit(use, 64, async (e) => {
    const full = joinPath(target, e.name);
    if (e.isSymbolicLink()) return { link: true, st: null };
    return fsp.lstat(full).then((st) => ({ link: false, st })).catch(() => null);
  });

  const items = use.map((e, i) => {
    const info = stats[i];
    const link = e.isSymbolicLink();
    const dir = !link && e.isDirectory();
    return {
      name: e.name,
      path: joinPath(target, e.name),
      dir,
      link,
      size: !dir && !link && info?.st ? info.st.size : 0,
      mtime: info?.st ? info.st.mtimeMs : 0,
      hidden: isHiddenName(e.name),
    };
  });

  return {
    path: target,
    parent: target === path.parse(target).root ? null : path.dirname(target),
    items,
    total: ents.length,
    truncated,
  };
}

/* ---------- 磁盘 ---------- */

const LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
let disksCache = { at: 0, data: null };
let volumeMeta = { at: 0, data: new Map() };

function runPs(script, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { maxBuffer: 16 * 1024 * 1024, timeout, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

async function getVolumeMeta() {
  if (Date.now() - volumeMeta.at < 10 * 60_000) return volumeMeta.data;
  const map = new Map();
  try {
    const raw = await runPs(
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
      'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,FileSystem | ' +
      'ConvertTo-Json -Compress',
      8000,
    );
    let rows = JSON.parse(raw || '[]');
    if (!Array.isArray(rows)) rows = [rows];
    for (const r of rows) {
      if (!r?.DeviceID) continue;
      map.set(r.DeviceID.toUpperCase(), {
        label: (r.VolumeName || '').trim(),
        fs: (r.FileSystem || '').trim(),
      });
    }
  } catch { /* 卷标拿不到就算了，容量本身来自 statfs */ }
  volumeMeta = { at: Date.now(), data: map };
  return map;
}

async function getDisks() {
  if (Date.now() - disksCache.at < 3000 && disksCache.data) return disksCache.data;

  const found = await mapLimit(LETTERS, 8, async (L) => {
    const root = `${L}:${W}`;
    try {
      const st = await fsp.statfs(root);
      const total = st.bsize * st.blocks;
      const free = st.bsize * st.bavail;
      if (!total || total <= 0) return null;
      return { drive: `${L}:`, root, total, free: Math.max(0, free), used: Math.max(0, total - free) };
    } catch { return null; }
  });

  const meta = await getVolumeMeta();
  const data = found.filter(Boolean).map((d) => {
    const m = meta.get(d.drive.toUpperCase()) || {};
    return { ...d, label: m.label || '本地磁盘', fs: m.fs || '' };
  });
  disksCache = { at: Date.now(), data };
  return data;
}

/* ---------- 已安装应用 ---------- */

const PS_APPS = [
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
  "$ErrorActionPreference='SilentlyContinue';",
  "$keys=@('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
  "'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
  'Get-ItemProperty $keys | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and',
  "-not $_.ParentKeyName -and $_.ReleaseType -notin @('Update','Hotfix','ServicePack') } |",
  'ForEach-Object { [pscustomobject]@{',
  'name=$_.DisplayName; version=$_.DisplayVersion; publisher=$_.Publisher;',
  'location=$_.InstallLocation; size=$_.EstimatedSize; icon=$_.DisplayIcon } } |',
  'ConvertTo-Json -Compress -Depth 3',
].join('\n');

let appsCache = { at: 0, data: null };

function normalizeApp(a) {
  const clean = (s) => String(s ?? '').trim().replace(/^"|"$/g, '');
  let location = clean(a.location);
  let icon = clean(a.icon).replace(/,\s*-?\d+$/, '').replace(/^"|"$/g, '');

  if (!location && icon) {
    try { location = path.dirname(icon); } catch { location = ''; }
  }
  if (location && !location.endsWith(W)) location += W;

  const size = Number(a.size) > 0 ? Number(a.size) * 1024 : 0;
  return {
    name: clean(a.name),
    version: clean(a.version),
    publisher: clean(a.publisher),
    location,
    icon: fs.existsSync(icon) ? icon : '',
    size,
    exists: Boolean(location) && fs.existsSync(location),
  };
}

async function getApps() {
  if (Date.now() - appsCache.at < 5 * 60_000 && appsCache.data) return appsCache.data;
  const raw = await runPs(PS_APPS);
  let rows = JSON.parse(raw || '[]');
  if (!Array.isArray(rows)) rows = [rows];

  const seen = new Set();
  const data = [];
  for (const r of rows) {
    if (!r?.name) continue;
    const app = normalizeApp(r);
    const key = `${app.name.toLowerCase()}|${app.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    data.push(app);
  }
  data.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  appsCache = { at: Date.now(), data };
  return data;
}

/* ---------- 大文件扫描 ---------- */

const big = {
  running: false, root: '', limit: 20, scanned: 0, dirs: 0,
  startedAt: 0, endedAt: 0, top: [], current: '', cancelled: false, error: '',
};
let bigGen = 0;

function offerBig(file) {
  const top = big.top;
  if (top.length >= big.limit && file.size <= top[top.length - 1].size) return;
  top.push(file);
  top.sort((a, b) => b.size - a.size);
  if (top.length > big.limit) top.length = big.limit;
}

async function runBigScan(root, limit) {
  const gen = ++bigGen;
  Object.assign(big, {
    running: true, root, limit, scanned: 0, dirs: 0,
    startedAt: Date.now(), endedAt: 0, top: [], current: root,
    cancelled: false, error: '',
  });

  const stack = [root];
  try {
    while (stack.length && !big.cancelled && gen === bigGen) {
      const dir = stack.pop();
      big.current = dir;
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }

      const files = [];
      for (const e of ents) {
        if (e.isSymbolicLink()) continue;
        const p = joinPath(dir, e.name);
        if (e.isDirectory()) { stack.push(p); big.dirs++; }
        else if (e.isFile()) files.push(p);
      }
      for (let i = 0; i < files.length; i += 64) {
        if (big.cancelled || gen !== bigGen) break;
        const chunk = files.slice(i, i + 64);
        const stats = await Promise.all(chunk.map((f) => fsp.lstat(f).catch(() => null)));
        for (let k = 0; k < stats.length; k++) {
          const st = stats[k];
          if (!st) continue;
          big.scanned++;
          offerBig({ path: chunk[k], size: st.size, mtime: st.mtimeMs });
        }
      }
    }
  } catch (e) {
    big.error = e.message;
  }

  if (gen !== bigGen) return; // 已被新任务取代
  big.running = false;
  big.endedAt = Date.now();
  big.current = '';
}

/* ---------- HTTP ---------- */

async function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return json(res, 404, { error: 'not found' });
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

async function handle(req, res) {
  lastHit = Date.now();
  closingSince = 0;
  const url = new URL(req.url, 'http://127.0.0.1');
  const { pathname } = url;

  try {
    if (pathname === '/api/ping') return json(res, 200, { app: 'OrangeDisk', ok: true, uptime: Date.now() - START });
    if (pathname === '/api/bye') { closingSince = Date.now(); return json(res, 200, { ok: true }); }
    if (pathname === '/api/disks') return json(res, 200, await getDisks());

    if (pathname === '/api/list') {
      const target = safePath(url.searchParams.get('path'));
      if (!target) return json(res, 400, { error: '路径无效' });
      return json(res, 200, await listDir(target));
    }

    if (pathname === '/api/size') {
      const target = safePath(url.searchParams.get('path'));
      if (!target) return json(res, 400, { error: '路径无效' });

      let aborted = false;
      res.on('close', () => { if (!res.writableEnded) aborted = true; });

      const r = await sizeOf(target, () => aborted);
      if (aborted) return;
      return json(res, 200, { path: target, ...r });
    }

    if (pathname === '/api/apps') return json(res, 200, await getApps());

    if (pathname === '/api/scan/start' && req.method === 'POST') {
      if (big.running) return json(res, 409, { error: '已有扫描正在进行' });
      const body = await readJson(req);
      const root = safePath(body.path);
      if (!root) return json(res, 400, { error: '路径无效' });
      if (!fs.existsSync(root)) return json(res, 404, { error: '路径不存在' });
      const limit = Math.min(100, Math.max(5, Number(body.limit) || 20));
      runBigScan(root, limit);
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/scan/status') {
      return json(res, 200, {
        started: big.startedAt > 0,
        running: big.running,
        root: big.root,
        limit: big.limit,
        scanned: big.scanned,
        dirs: big.dirs,
        elapsed: big.startedAt ? (big.endedAt || Date.now()) - big.startedAt : 0,
        current: big.current,
        cancelled: big.cancelled,
        top: big.top,
        error: big.error,
      });
    }

    if (pathname === '/api/scan/cancel' && req.method === 'POST') {
      big.cancelled = true;
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/reveal' && req.method === 'POST') {
      const body = await readJson(req);
      const target = safePath(body.path);
      if (!target || !fs.existsSync(target)) return json(res, 404, { error: '路径不存在' });
      let isFile = false;
      try { isFile = (await fsp.stat(target)).isFile(); } catch { /* ignore */ }
      // 文件的 /select 需要保留引号，否则带空格的路径会失效
      const args = isFile ? [`/select,"${target}"`] : [target];
      spawn('explorer.exe', args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: isFile }).unref();
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/refresh') {
      sizeCache.clear();
      disksCache = { at: 0, data: null };
      volumeMeta = { at: 0, data: new Map() };
      appsCache = { at: 0, data: null };
      return json(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });

    return serveStatic(res, pathname);
  } catch (e) {
    if (!res.writableEnded) json(res, e.status || 500, { error: e.message || '服务器错误' });
  }
}

/* ---------- 启动 ---------- */

function isOurInstance(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 900 }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => resolve(d.includes('OrangeDisk')));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function openWindow(port) {
  if (process.env.ORANGE_NO_OPEN) { console.log(`OrangeDisk ready: http://127.0.0.1:${port}/`); return; }
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const edge = candidates.find((p) => fs.existsSync(p));
  const target = `http://127.0.0.1:${port}/`;
  if (!edge) {
    console.log(`OrangeDisk 已启动：${target}`);
    spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const profile = path.join(process.env.LOCALAPPDATA || HERE, 'OrangeDisk', 'browser');
  const args = [
    `--app=${target}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=msEdgeFirstRunExperience,msEdgeSidebarV2',
    '--window-size=1340,900',
  ];
  const child = spawn(edge, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  console.log(`OrangeDisk 已启动：${target}`);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (e) => { server.off('listening', onOk); reject(e); };
    const onOk = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onOk);
    server.listen(port, '127.0.0.1');
  });
}

async function main() {
  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    if (await isOurInstance(port)) { openWindow(port); return; }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.writableEnded) json(res, 500, { error: e.message });
    });
  });

  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    try {
      await listen(server, port);
      openWindow(port);
      break;
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }

  // 页面已关闭（bye）或长时间无心跳时自动退出，避免留下孤儿进程
  setInterval(() => {
    if (closingSince && Date.now() - closingSince > 60_000) process.exit(0);
    if (Date.now() - lastHit > 10 * 60_000 && Date.now() - START > 60_000) process.exit(0);
  }, 30_000).unref();
}

main();
