/* OrangeDisk · 前端 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    tabs: $('#tabs'),
    pill: $('#tabPill'),
    views: {
      disks: $('#view-disks'),
      files: $('#view-files'),
      big: $('#view-big'),
      apps: $('#view-apps'),
      clean: $('#view-clean'),
    },
    miniStat: $('#miniStat'),
    refresh: $('#refreshBtn'),
    diskGrid: $('#diskGrid'),
    diskSummary: $('#diskSummary'),
    statRow: $('#statRow'),
    crumbs: $('#crumbs'),
    backBtn: $('#backBtn'),
    sortSeg: $('#sortSeg'),
    hiddenToggle: $('#hiddenToggle'),
    scanBar: $('#scanBar'),
    scanText: $('#scanText'),
    scanFill: $('#scanFill'),
    fileHead: $('.file-head'),
    fileList: $('#fileList'),
    fileEmpty: $('#fileEmpty'),
    appList: $('#appList'),
    appEmpty: $('#appEmpty'),
    appSummary: $('#appSummary'),
    appSearch: $('#appSearch'),
    bigDiskSeg: $('#bigDiskSeg'),
    bigBtn: $('#bigBtn'),
    bigProgress: $('#bigProgress'),
    bigTitle: $('#bigTitle'),
    bigStats: $('#bigStats'),
    bigPath: $('#bigPath'),
    bigFill: $('#bigFill'),
    bigList: $('#bigList'),
    bigEmpty: $('#bigEmpty'),
    cleanList: $('#cleanList'),
    cleanEmpty: $('#cleanEmpty'),
    cleanSummary: $('#cleanSummary'),
    cleanRescan: $('#cleanRescan'),
    cleanRun: $('#cleanRun'),
    cleanTotal: $('#cleanTotal'),
    cleanTotalSize: $('#cleanTotalSize'),
    cleanTotalHint: $('#cleanTotalHint'),
    cleanModal: $('#cleanModal'),
    cleanModalBody: $('#cleanModalBody'),
    cleanCancel: $('#cleanCancel'),
    cleanConfirm: $('#cleanConfirm'),
    toast: $('#toast'),
  };

  const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const W = '\\';

  const state = {
    tab: 'disks',
    disks: [],
    files: {
      path: null,
      parent: null,
      items: [],
      sizes: new Map(),
      rows: new Map(),
      sort: 'size',
      showHidden: false,
      token: 0,
      ctrl: null,
      busy: false,
    },
    apps: { data: null, query: '', totalKnown: 0, loading: false },
    big: { root: null, timer: 0, busy: false, data: null, sig: '' },
    clean: { cats: [], sel: new Set(), sizes: new Map(), token: 0, loaded: false, cleaning: false, confirmMode: '' },
  };

  /* ---------------- 工具 ---------------- */

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  function fmtBytes(n, fixed) {
    n = Number(n) || 0;
    if (n <= 0) return '0 B';
    let i = 0;
    while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++; }
    const d = fixed ?? (i >= 3 ? 1 : i === 2 ? (n >= 100 ? 0 : 1) : 0);
    return `${n.toFixed(d)} ${UNITS[i]}`;
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let msg = `请求失败 (${res.status})`;
      try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }

  let toastTimer = 0;
  function toast(msg, isError) {
    clearTimeout(toastTimer);
    els.toast.textContent = msg;
    els.toast.classList.toggle('err', Boolean(isError));
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function animateNumber(el, to, format, duration = 850) {
    const from = 0;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, Math.max(0, (t - t0) / duration));
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = format(from + (to - from) * eased);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const ICON = {
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h4.1l1.9 2.3h7.6A2.2 2.2 0 0 1 21 9.5v7.3A2.2 2.2 0 0 1 18.8 19H5.2A2.2 2.2 0 0 1 3 16.8z" fill="currentColor"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 3h7.1L19 8.7V20a1 1 0 0 1-1 1H6.2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13 3v6h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    empty: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 20a6 6 0 0 1 6-6h11l6 7h19a6 6 0 0 1 6 6v19a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6z" fill="#ffe6d2"/><path d="M8 26h48" stroke="#ffc89c" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="40" r="3" fill="#ffbf8c"/><circle cx="38" cy="40" r="3" fill="#ffbf8c"/><path d="M27 47c3 2.4 7 2.4 10 0" stroke="#ffbf8c" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
    open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 4 11.5 12.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M18.5 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V6a1.5 1.5 0 0 1 1.5-1.5H10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    junk: {
      system: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="7.5" height="6.5" rx="1.6" fill="currentColor"/><rect x="13" y="4.5" width="7.5" height="6.5" rx="1.6" fill="currentColor"/><rect x="3.5" y="13" width="7.5" height="6.5" rx="1.6" fill="currentColor"/><rect x="13" y="13" width="7.5" height="6.5" rx="1.6" fill="currentColor"/></svg>',
      app: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.9"/><rect x="13.5" y="4.5" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.9"/><rect x="4.5" y="13.5" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.9"/><rect x="13.5" y="13.5" width="6" height="6" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.9"/></svg>',
      shader: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M10 3.5v3.5M14 3.5v3.5M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
      recycle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 7h15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M9.5 7V4.8h5V7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M7 7l1 12.2h8L17 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M10.5 10.5v5.5M13.5 10.5v5.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    },
  };

  /* ---------------- 视图切换 ---------------- */

  function movePill() {
    const active = $('.tab.active', els.tabs);
    if (!active) return;
    els.pill.style.left = `${active.offsetLeft}px`;
    els.pill.style.width = `${active.offsetWidth}px`;
  }

  function setTab(name) {
    if (!els.views[name]) return;
    state.tab = name;
    $$('.tab', els.tabs).forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    Object.entries(els.views).forEach(([k, v]) => v.classList.toggle('active', k === name));
    movePill();

    if (name === 'apps' && !state.apps.data && !state.apps.loading) loadApps();
    if (name === 'big') syncBig();
    if (name === 'clean' && !state.clean.loaded) loadClean();
    if (name === 'files' && !state.files.path) {
      const root = state.disks[0]?.root || 'C:\\';
      openPath(root);
    }
  }

  /* ---------------- 磁盘 ---------------- */

  function renderDiskSkeleton() {
    els.diskGrid.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
  }

  function updateTotals(disks) {
    const total = disks.reduce((s, d) => s + d.total, 0);
    const used = disks.reduce((s, d) => s + d.used, 0);
    const free = Math.max(0, total - used);

    els.miniStat.classList.remove('skeleton');
    els.miniStat.innerHTML = `<span>可用空间</span><b>${fmtBytes(free)}</b>`;
    els.diskSummary.textContent = `${disks.length} 个磁盘 · 共 ${fmtBytes(total)} 可用 ${fmtBytes(free)}`;
    els.statRow.innerHTML = `
      <div class="stat"><span>总容量</span><b>${fmtBytes(total)}</b></div>
      <div class="stat"><span>已用</span><b>${fmtBytes(used)}</b></div>
      <div class="stat"><span>可用</span><b>${fmtBytes(free)}</b></div>`;
  }

  function renderDisks(disks) {
    state.disks = disks;
    if (!disks.length) {
      els.diskGrid.innerHTML = '';
      els.diskSummary.textContent = '没有检测到磁盘';
      return;
    }

    els.diskGrid.innerHTML = disks.map((d, i) => {
      const pct = d.total ? Math.min(100, Math.max(0, (d.used / d.total) * 100)) : 0;
      const hot = pct >= 88 ? 'hot' : '';
      return `
        <article class="disk-card ${hot}" data-root="${esc(d.root)}" style="animation-delay:${i * 70}ms">
          <div class="donut">
            <svg viewBox="0 0 120 120">
              <circle class="ring-bg" cx="60" cy="60" r="48"/>
              <circle class="ring-fg" cx="60" cy="60" r="48" style="--p:0"/>
            </svg>
            <div class="donut-label"><b>0%</b><span>已用</span></div>
          </div>
          <div class="disk-body">
            <div class="disk-top">
              <h3>${esc(d.drive)}</h3>
              <span class="vol" title="${esc(d.label)}">${esc(d.label)}</span>
              <span class="fs">${esc(d.fs || 'DISK')}</span>
            </div>
            <div class="disk-numbers"><b>0 B</b><span>已用 / ${fmtBytes(d.total)}</span></div>
            <div class="disk-bar"><i style="width:0"></i></div>
            <div class="disk-foot"><span>可用 ${fmtBytes(d.free)}</span><span class="go">查看文件夹 →</span></div>
          </div>
        </article>`;
    }).join('');

    updateTotals(disks);

    requestAnimationFrame(() => {
      $$('.disk-card', els.diskGrid).forEach((card, i) => {
        const d = disks[i];
        const pct = d.total ? Math.min(100, Math.max(0, (d.used / d.total) * 100)) : 0;
        card.querySelector('.ring-fg').style.setProperty('--p', pct.toFixed(2));
        card.querySelector('.disk-bar i').style.width = `${pct.toFixed(2)}%`;
        animateNumber(card.querySelector('.donut-label b'), pct, (v) => `${Math.round(v)}%`);
        animateNumber(card.querySelector('.disk-numbers b'), d.used, (v) => fmtBytes(v));
      });
    });
  }

  async function loadDisks() {
    renderDiskSkeleton();
    try {
      const disks = await api('/api/disks');
      renderDisks(disks);
      buildBigDisks();
    } catch (e) {
      els.diskGrid.innerHTML = '';
      els.diskSummary.textContent = '读取磁盘信息失败';
      toast(e.message, true);
    }
  }

  /* ---------------- 文件浏览 ---------------- */

  function renderCrumbs(p) {
    const segs = p.split(W).filter(Boolean);
    const parts = [];
    let acc = '';
    segs.forEach((seg, i) => {
      acc = i === 0 ? seg + W : acc.replace(/\\$/, '') + W + seg;
      parts.push({ label: seg, path: acc });
    });
    if (!parts.length) return;

    const last = parts.length - 1;
    const visible = [];
    if (parts.length <= 5) {
      parts.forEach((x, i) => visible.push({ ...x, i }));
    } else {
      visible.push({ ...parts[0], i: 0 });
      visible.push({ ellipsis: true });
      for (let i = parts.length - 3; i <= last; i++) visible.push({ ...parts[i], i });
    }

    els.crumbs.innerHTML = visible.map((x, idx) => {
      const sep = idx > 0 ? '<span class="crumb-sep">›</span>' : '';
      if (x.ellipsis) return `${sep}<span class="crumb-sep">…</span>`;
      return `${sep}<button class="crumb${x.i === last ? ' current' : ''}" data-path="${esc(x.path)}" title="${esc(x.path)}">${esc(x.label)}</button>`;
    }).join('');
  }

  function computeTotal() {
    let total = 0;
    for (const it of state.files.items) {
      if (!state.files.showHidden && it.hidden) continue;
      total += it.dir ? (state.files.sizes.get(it.path)?.size || 0) : it.size;
    }
    return total || 1;
  }

  function refreshBars() {
    const total = computeTotal();
    for (const [path, row] of state.files.rows) {
      const it = row.item;
      const size = it.dir ? (state.files.sizes.get(it.path)?.size || 0) : it.size;
      row.bar.style.width = `${Math.min(100, (size / total) * 100)}%`;
    }
  }

  function sortedItems() {
    const { items, sizes, sort, showHidden } = state.files;
    const sizeOf = (it) => (it.dir ? (sizes.get(it.path)?.size ?? -1) : it.size);
    return items
      .filter((it) => showHidden || !it.hidden)
      .sort((a, b) => {
        if (a.dir !== b.dir) return a.dir ? -1 : 1;
        if (sort === 'size') {
          const d = sizeOf(b) - sizeOf(a);
          if (d !== 0) return d;
        } else if (sort === 'time') {
          const d = (b.mtime || 0) - (a.mtime || 0);
          if (d !== 0) return d;
        }
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
      });
  }

  function renderFiles(flip) {
    const { sizes } = state.files;
    const prev = flip ? new Map([...state.files.rows].map(([p, r]) => [p, r.el.getBoundingClientRect().top])) : null;
    state.files.rows.clear();
    els.fileList.innerHTML = '';

    const list = sortedItems();
    if (!list.length) {
      els.fileEmpty.hidden = false;
      els.fileEmpty.innerHTML = `${ICON.empty}<div>这个文件夹是空的</div>`;
      return;
    }
    els.fileEmpty.hidden = true;

    const frag = document.createDocumentFragment();
    list.forEach((it, idx) => {
      const known = it.dir ? sizes.get(it.path) : null;
      const el = document.createElement('div');
      el.className = `frow${it.dir ? ' is-dir' : ''}`;
      el.dataset.path = it.path;
      if (!flip) el.style.animationDelay = `${Math.min(idx, 16) * 16}ms`;
      else el.style.animation = 'none';
      el.title = it.dir ? it.path : `${it.path}\n双击在资源管理器中查看`;
      el.innerHTML = `
        <span class="ficon ${it.dir ? 'dir' : 'file'}">${it.dir ? ICON.folder : ICON.file}</span>
        <span class="fname">${esc(it.name)}${it.link ? '<em class="tag">链接</em>' : ''}</span>
        <button class="reveal-btn" data-path="${esc(it.path)}" title="在资源管理器中打开">${ICON.open}</button>
        <span class="fsize${known ? ' done' : ''}">${it.dir ? (known ? sizeText(known) : '<i class="shine"></i>') : fmtBytes(it.size)}</span>
        <span class="fbar"><i></i></span>
        <span class="ftime">${fmtDate(it.mtime)}</span>`;
      state.files.rows.set(it.path, {
        item: it,
        el,
        size: el.querySelector('.fsize'),
        bar: el.querySelector('.fbar i'),
      });
      frag.appendChild(el);
    });
    els.fileList.appendChild(frag);
    refreshBars();

    if (prev) {
      for (const [path, row] of state.files.rows) {
        const before = prev.get(path);
        if (before === undefined) continue;
        const dy = before - row.el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) {
          row.el.animate(
            [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
            { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' },
          );
        }
      }
    }
  }

  function sizeText(r) {
    return `${r.truncated ? '≥ ' : ''}${fmtBytes(r.size)}`;
  }

  function setScanBar(on, done, total) {
    els.scanBar.classList.toggle('on', on);
    if (on) {
      els.scanText.textContent = `正在统计文件夹大小 · ${done} / ${total}`;
      els.scanFill.style.width = `${total ? (done / total) * 100 : 0}%`;
    }
  }

  let sortTimer = 0;
  function scheduleSort() {
    if (sortTimer) return;
    sortTimer = setTimeout(() => {
      sortTimer = 0;
      if (state.tab === 'files') renderFiles(true);
    }, 550);
  }

  function updateRow(it) {
    const row = state.files.rows.get(it.path);
    const r = state.files.sizes.get(it.path);
    if (!row || !r) return;
    row.size.classList.add('done');
    row.size.innerHTML = sizeText(r);
    row.size.title = r.truncated ? '统计超时，显示已统计的部分' : `${r.files} 个文件`;
    refreshBars();
    if (state.files.sort === 'size') scheduleSort();
  }

  async function scanSizes() {
    const { files } = state;
    const token = files.token;
    const dirs = files.items.filter((it) => it.dir && it.dir !== null && !files.sizes.has(it.path));
    if (!dirs.length) { setScanBar(false); return; }

    const ctrl = new AbortController();
    files.ctrl?.abort();
    files.ctrl = ctrl;

    let done = 0;
    const total = dirs.length;
    const queue = dirs.slice();
    setScanBar(true, 0, total);

    const worker = async () => {
      while (queue.length) {
        if (token !== files.token || ctrl.signal.aborted) return;
        const it = queue.shift();
        try {
          const r = await fetch(`/api/size?path=${encodeURIComponent(it.path)}`, { signal: ctrl.signal }).then((res) => res.json());
          if (token !== files.token) return;
          files.sizes.set(it.path, r);
          updateRow(it);
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
        done++;
        setScanBar(true, done, total);
      }
    };

    await Promise.all([worker(), worker(), worker(), worker()]);

    if (token !== files.token) return;
    setScanBar(false);
    if (files.sort === 'size') {
      clearTimeout(sortTimer);
      sortTimer = 0;
      renderFiles(true);
    }
  }

  async function openPath(p) {
    const files = state.files;
    const token = ++files.token;
    files.ctrl?.abort();
    clearTimeout(sortTimer);
    sortTimer = 0;
    files.path = p;
    files.rows.clear();
    files.busy = true;

    renderCrumbs(p);
    setScanBar(false);
    els.fileEmpty.hidden = true;
    els.fileList.innerHTML = Array.from({ length: 6 }, () => '<div class="frow"><span class="ficon dir"></span><span class="fname"><i class="shine" style="width:140px"></i></span><span class="fsize"><i class="shine"></i></span><span class="fbar"></span><span class="ftime"></span></div>').join('');

    try {
      const data = await api(`/api/list?path=${encodeURIComponent(p)}`);
      if (token !== files.token) return;
      files.items = data.items;
      files.parent = data.parent;
      files.busy = false;
      els.backBtn.hidden = !data.parent;

      if (data.truncated) toast(`项目较多，只显示前 ${data.items.length} 项`);
      renderFiles();
      scanSizes();
    } catch (e) {
      if (token !== files.token) return;
      files.busy = false;
      files.items = [];
      files.rows.clear();
      els.fileList.innerHTML = '';
      els.fileEmpty.hidden = false;
      els.fileEmpty.innerHTML = `${ICON.empty}<div>${esc(e.message)}</div>`;
      toast(e.message, true);
    }
  }

  /* ---------------- 应用 ---------------- */

  function hueOf(name) {
    const palette = [14, 20, 26, 32, 39, 45];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  }

  function renderApps() {
    const { data, query, totalKnown } = state.apps;
    if (!data) return;

    const q = query.trim().toLowerCase();
    const list = q
      ? data.filter((a) => a.name.toLowerCase().includes(q) || (a.publisher || '').toLowerCase().includes(q))
      : data;

    els.appSummary.textContent = `${data.length} 个应用 · 已知占用 ${fmtBytes(totalKnown)}`;

    if (!list.length) {
      els.appList.innerHTML = '';
      els.appEmpty.hidden = false;
      els.appEmpty.innerHTML = `${ICON.empty}<div>没有匹配的应用</div>`;
      return;
    }
    els.appEmpty.hidden = true;

    els.appList.innerHTML = list.map((a, idx) => {
      const initial = esc((a.name.match(/[A-Za-z0-9\u4e00-\u9fa5]/) || ['?'])[0].toUpperCase());
      const meta = [a.publisher, a.version ? `v${a.version}` : ''].filter(Boolean).join(' · ') || '未知发布者';
      const share = totalKnown ? (a.size / totalKnown) * 100 : 0;
      const sizeCell = a.size
        ? `<b>${fmtBytes(a.size)}</b><span>占 ${share.toFixed(1)}%</span>`
        : '<span>未知</span>';
      return `
        <div class="arow" style="animation-delay:${Math.min(idx, 16) * 14}ms"${a.exists ? ` data-open="${esc(a.location)}"` : ''}>
          <span class="aicon" style="--h:${hueOf(a.name)}">${initial}</span>
          <div class="amain"><b title="${esc(a.name)}">${esc(a.name)}</b><span title="${esc(meta)}">${esc(meta)}</span></div>
          <span class="asize${a.size ? '' : ' unknown'}">${sizeCell}</span>
          ${a.exists ? `<button class="amin-btn" data-open="${esc(a.location)}">打开</button>` : '<span></span>'}
        </div>`;
    }).join('');
  }

  async function loadApps() {
    state.apps.loading = true;
    els.appList.innerHTML = Array.from({ length: 6 }, () => '<div class="arow"><span class="aicon" style="--h:24"></span><div class="amain"><b><i class="shine" style="width:170px"></i></b><span><i class="shine" style="width:110px"></i></span></div><span class="asize"><i class="shine"></i></span><span></span></div>').join('');
    els.appSummary.textContent = '读取已安装应用…';
    try {
      const data = await api('/api/apps');
      state.apps.data = data;
      state.apps.totalKnown = data.reduce((s, a) => s + (a.size || 0), 0);
      renderApps();
    } catch (e) {
      els.appList.innerHTML = '';
      els.appEmpty.hidden = false;
      els.appEmpty.innerHTML = `${ICON.empty}<div>${esc(e.message)}</div>`;
    } finally {
      state.apps.loading = false;
    }
  }

  /* ---------------- 大文件 ---------------- */

  const fmtDur = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} 秒`;
    return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  };

  function buildBigDisks() {
    if (!state.disks.length) return;
    if (!state.big.root) state.big.root = state.disks[0].root;
    const cur = els.bigDiskSeg.querySelector('button.on')?.dataset.root;
    if (cur === state.big.root && els.bigDiskSeg.children.length === state.disks.length) return;
    els.bigDiskSeg.innerHTML = state.disks.map((d) => (
      `<button data-root="${esc(d.root)}" class="${d.root === state.big.root ? 'on' : ''}">${esc(d.drive)}</button>`
    )).join('');
  }

  function setBigEmpty(text, visible = true) {
    if (!visible) { els.bigEmpty.hidden = true; return; }
    els.bigEmpty.innerHTML = `${ICON.empty}<div>${esc(text)}</div>`;
    els.bigEmpty.hidden = false;
  }

  function renderBigList(top) {
    const sig = top.map((f) => f.path).join('|');
    if (sig === state.big.sig) return;
    state.big.sig = sig;
    const max = top[0]?.size || 1;
    els.bigList.innerHTML = top.map((f, i) => {
      const cut = f.path.lastIndexOf(W);
      const name = cut >= 0 ? f.path.slice(cut + 1) : f.path;
      const dir = cut >= 0 ? f.path.slice(0, cut) : f.path;
      return `<div class="brow" data-path="${esc(f.path)}" style="animation-delay:${Math.min(i, 12) * 18}ms" title="${esc(f.path)}">
        <span class="brank">${i + 1}</span>
        <div class="bmain"><b>${esc(name)}</b><span>${esc(dir)}</span></div>
        <button class="reveal-btn" data-path="${esc(f.path)}" title="在资源管理器中打开">${ICON.open}</button>
        <span class="bsize">${fmtBytes(f.size)}</span>
        <span class="bbar"><i style="width:${Math.max(3, (f.size / max) * 100)}%"></i></span>
      </div>`;
    }).join('');
  }

  function renderBig(s) {
    state.big.data = s;
    const { started, running } = s;

    els.bigProgress.hidden = !started;
    els.bigBtn.textContent = running ? '取消扫描' : started ? '重新扫描' : '开始扫描';
    els.bigBtn.classList.toggle('danger', running);

    if (started) {
      els.bigTitle.textContent = running ? `正在扫描 ${s.root}` : s.error ? '扫描出错' : s.cancelled ? '已取消扫描' : '扫描完成';
      els.bigStats.textContent = running
        ? `${s.scanned.toLocaleString()} 个文件 · ${s.dirs.toLocaleString()} 个文件夹 · ${fmtDur(s.elapsed)}`
        : `${s.scanned.toLocaleString()} 个文件 · 用时 ${fmtDur(s.elapsed)}`;
      els.bigPath.textContent = running ? s.current || '' : s.error || s.root;
      els.bigFill.classList.toggle('done', !running);
    }

    if (!started) {
      els.bigList.innerHTML = '';
      setBigEmpty('选一块磁盘，点「开始扫描」找找谁最占地方');
      return;
    }

    const top = s.top || [];
    renderBigList(top);
    if (top.length) setBigEmpty('', false);
    else setBigEmpty(running ? '正在找大文件…' : '这块盘里没有找到文件');
  }

  async function pollBig() {
    if (state.big.busy) return;
    state.big.busy = true;
    clearTimeout(state.big.timer);
    state.big.timer = 0;
    let running = false;
    try {
      const s = await api('/api/scan/status');
      renderBig(s);
      running = s.running;
    } catch {
      toast('无法获取扫描状态', true);
    } finally {
      state.big.busy = false;
    }
    if (running) state.big.timer = setTimeout(pollBig, 700);
  }

  async function startBig() {
    if (state.big.data?.running) {
      api('/api/scan/cancel', { method: 'POST' }).catch(() => {});
      return;
    }
    const root = state.big.root || state.disks[0]?.root;
    if (!root) { toast('没有可扫描的磁盘', true); return; }
    try {
      await api('/api/scan/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: root, limit: 20 }),
      });
      state.big.sig = '';
      els.bigList.innerHTML = '';
      setBigEmpty('', false);
      pollBig();
    } catch (e) {
      toast(e.message, true);
    }
  }

  function syncBig() {
    buildBigDisks();
    if (!state.big.timer) pollBig();
  }

  /* ---------------- 清理垃圾 ---------------- */

  function reveal(path) {
    if (!path) return;
    api('/api/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }).catch((err) => toast(err.message, true));
  }

  function renderClean() {
    const { cats, sizes, sel } = state.clean;
    const riskText = { safe: '安全', warn: '注意', danger: '危险' };

    if (!cats.length) {
      els.cleanList.innerHTML = '';
      els.cleanEmpty.hidden = false;
      els.cleanEmpty.innerHTML = `${ICON.empty}<div>没有可清理的分类</div>`;
      return;
    }
    els.cleanEmpty.hidden = true;

    els.cleanList.innerHTML = cats.map((cat, i) => {
      const s = sizes.get(cat.id);
      const on = sel.has(cat.id);
      const paths = (cat.paths || []).slice(0, 3)
        .map((p) => `<span class="cpath" title="${esc(p)}">${esc(p)}</span>`).join('');
      const sizeCell = s
        ? `<b>${fmtBytes(s.size)}</b><span>${s.files.toLocaleString()} 个文件${s.truncated ? ' · 已截断' : ''}</span>`
        : '<b><i class="shine"></i></b><span>扫描中…</span>';
      const openBtn = (cat.paths && cat.paths.length)
        ? `<button class="copen" data-path="${esc(cat.paths[0])}" title="在资源管理器中打开">${ICON.open}</button>`
        : '<span></span>';
      return `<div class="ccard${on ? ' on' : ''}" data-id="${cat.id}" style="animation-delay:${Math.min(i, 8) * 26}ms">
        <label class="cbox" title="选择这一类">
          <input type="checkbox" data-id="${cat.id}"${on ? ' checked' : ''}>
          <i></i>
        </label>
        <span class="cico src-${cat.source}">${ICON.junk[cat.source] || ''}</span>
        <div class="cmain">
          <div class="ctitle"><b>${esc(cat.name)}</b><em class="risk ${cat.risk}">${riskText[cat.risk] || ''}</em>${cat.admin ? '<em class="badge-admin">需要管理员</em>' : ''}</div>
          <div class="cdesc">${esc(cat.desc)}</div>
          ${paths ? `<div class="cpaths">${paths}</div>` : ''}
        </div>
        <div class="csize${s ? '' : ' pending'}">${sizeCell}</div>
        ${openBtn}
      </div>`;
    }).join('');
  }

  function updateCleanCard(id) {
    const card = els.cleanList.querySelector(`.ccard[data-id="${id}"]`);
    const s = state.clean.sizes.get(id);
    if (!card || !s) return;
    const cell = card.querySelector('.csize');
    cell.classList.remove('pending');
    cell.innerHTML = `<b>${fmtBytes(s.size)}</b><span>${s.files.toLocaleString()} 个文件${s.truncated ? ' · 已截断' : ''}</span>`;
    updateCleanTotal();
  }

  function setCleanSel(id, on) {
    if (on) state.clean.sel.add(id);
    else state.clean.sel.delete(id);
    const card = els.cleanList.querySelector(`.ccard[data-id="${id}"]`);
    if (card) {
      card.classList.toggle('on', on);
      const input = card.querySelector('input[data-id]');
      if (input) input.checked = on;
    }
    updateCleanTotal();
  }

  function cleanSelectedTotal() {
    let total = 0;
    for (const id of state.clean.sel) total += state.clean.sizes.get(id)?.size || 0;
    return total;
  }

  function updateCleanTotal() {
    const total = cleanSelectedTotal();
    const n = state.clean.sel.size;
    els.cleanTotal.hidden = state.clean.cats.length === 0;
    els.cleanTotalSize.textContent = fmtBytes(total);
    els.cleanTotalHint.textContent = state.clean.cleaning
      ? '正在清理…'
      : n ? `已选 ${n} 类 · 删除后无法恢复` : '勾选下方分类后点「清理所选」';
    els.cleanRun.disabled = state.clean.cleaning || !n || total <= 0;
    els.cleanRun.textContent = state.clean.cleaning ? '清理中…' : '清理所选';
  }

  async function loadClean() {
    state.clean.loaded = true;
    const token = ++state.clean.token;
    state.clean.sizes = new Map();
    state.clean.confirmMode = '';
    els.cleanList.innerHTML = '';
    els.cleanEmpty.hidden = true;
    els.cleanSummary.textContent = '正在读取清理分类…';
    els.cleanRun.disabled = true;
    try {
      const cats = await api('/api/junk');
      if (token !== state.clean.token) return;
      state.clean.cats = cats;
      state.clean.sel = new Set(cats.filter((c) => c.enabled).map((c) => c.id));
      renderClean();
      updateCleanTotal();
      scanCleanSizes(token);
    } catch (e) {
      toast(e.message, true);
      els.cleanSummary.textContent = '读取清理分类失败';
    }
  }

  async function scanCleanSizes(token) {
    const cats = state.clean.cats.slice();
    const total = cats.length;
    let idx = 0;
    let done = 0;
    const worker = async () => {
      while (idx < total) {
        const cat = cats[idx++];
        if (token !== state.clean.token) return;
        try {
          const r = await api(`/api/junk/size?id=${encodeURIComponent(cat.id)}`);
          if (token !== state.clean.token) return;
          state.clean.sizes.set(cat.id, r);
          updateCleanCard(cat.id);
        } catch { /* 单个分类失败不影响其它 */ }
        done++;
        els.cleanSummary.textContent = `正在扫描缓存… ${done} / ${total}`;
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (token !== state.clean.token) return;
    const sum = cats.reduce((a, c) => a + (state.clean.sizes.get(c.id)?.size || 0), 0);
    els.cleanSummary.textContent = `共 ${total} 类可清理项目 · 合计约 ${fmtBytes(sum)}`;
    updateCleanTotal();
  }

  function openCleanModal() {
    const ids = [...state.clean.sel];
    const cats = state.clean.cats.filter((c) => ids.includes(c.id));
    if (!cats.length) return;
    const total = cleanSelectedTotal();
    els.cleanModalBody.innerHTML = `
      <div>将删除以下分类里的<strong>缓存文件</strong>，不会碰你的文档、桌面、下载。</div>
      ${cats.map((c) => {
        const s = state.clean.sizes.get(c.id);
        return `<div class="mrow"><span>${esc(c.name)}<span class="mtag">${(s?.files || 0).toLocaleString()} 个文件</span></span><b>${fmtBytes(s?.size || 0)}</b></div>`;
      }).join('')}
      <div class="mtotal"><span>合计可释放</span><b>${fmtBytes(total)}</b></div>
      <div class="mnote">正在使用或刚创建的临时文件会自动跳过；回收站清空后无法恢复。</div>`;
    els.cleanConfirm.textContent = '确认清理';
    els.cleanConfirm.disabled = false;
    els.cleanCancel.disabled = false;
    els.cleanCancel.hidden = false;
    els.cleanModal.hidden = false;
    state.clean.confirmMode = 'confirm';
  }

  function closeCleanModal() {
    els.cleanModal.hidden = true;
    els.cleanCancel.hidden = false;
    els.cleanCancel.disabled = false;
    els.cleanConfirm.disabled = false;
    state.clean.confirmMode = '';
  }

  async function doClean() {
    if (state.clean.confirmMode === 'done') {
      closeCleanModal();
      loadClean();
      return;
    }
    const ids = [...state.clean.sel];
    if (!ids.length) return;

    state.clean.cleaning = true;
    updateCleanTotal();
    els.cleanConfirm.disabled = true;
    els.cleanCancel.disabled = true;
    els.cleanConfirm.textContent = '清理中…';
    els.cleanModalBody.innerHTML = '<div style="padding:14px 0"><span class="spinner"></span> 正在删除所选缓存，请稍候…</div>';

    try {
      const r = await api('/api/junk/clean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      state.clean.confirmMode = 'done';
      els.cleanModalBody.innerHTML = `
        <div style="padding:4px 0 6px"><b>已释放 ${fmtBytes(r.freed)}</b></div>
        <div class="mrow"><span>删除文件</span><b>${r.deleted.toLocaleString()}</b></div>
        <div class="mrow"><span>跳过（正在使用 / 最近创建）</span><b>${r.skipped.toLocaleString()}</b></div>
        <div class="mnote">磁盘空间已经归还，可在「磁盘」页刷新查看可用容量。</div>`;
      els.cleanConfirm.disabled = false;
      els.cleanConfirm.textContent = '完成';
      els.cleanCancel.hidden = true;
      toast(`已释放 ${fmtBytes(r.freed)}`);
    } catch (e) {
      toast(e.message, true);
      els.cleanModalBody.innerHTML = `<div>清理失败：${esc(e.message)}</div>`;
      els.cleanConfirm.disabled = false;
      els.cleanConfirm.textContent = '重试';
      els.cleanCancel.disabled = false;
    } finally {
      state.clean.cleaning = false;
      updateCleanTotal();
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    els.tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (btn) setTab(btn.dataset.tab);
    });

    window.addEventListener('resize', movePill);

    els.refresh.addEventListener('click', async () => {
      els.refresh.classList.add('spin');
      setTimeout(() => els.refresh.classList.remove('spin'), 700);
      try {
        await fetch('/api/refresh', { method: 'POST' });
        state.files.sizes.clear();
        if (state.tab === 'disks') await loadDisks();
        if (state.tab === 'files' && state.files.path) await openPath(state.files.path);
        if (state.tab === 'apps') { state.apps.data = null; await loadApps(); }
        toast('已刷新');
      } catch {
        toast('刷新失败', true);
      }
    });

    els.diskGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.disk-card');
      if (!card) return;
      setTab('files');
      openPath(card.dataset.root);
    });

    els.crumbs.addEventListener('click', (e) => {
      const crumb = e.target.closest('.crumb');
      if (crumb && crumb.dataset.path) openPath(crumb.dataset.path);
    });

    els.backBtn.addEventListener('click', () => {
      if (state.files.parent) openPath(state.files.parent);
    });

    els.sortSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      state.files.sort = btn.dataset.sort;
      $$('button', els.sortSeg).forEach((b) => b.classList.toggle('on', b === btn));
      renderFiles();
    });

    els.hiddenToggle.addEventListener('click', () => {
      state.files.showHidden = !state.files.showHidden;
      els.hiddenToggle.setAttribute('aria-pressed', String(state.files.showHidden));
      els.hiddenToggle.textContent = state.files.showHidden ? '隐藏系统项' : '显示隐藏';
      renderFiles();
    });

    els.fileList.addEventListener('click', (e) => {
      const open = e.target.closest('.reveal-btn');
      if (open) { reveal(open.dataset.path); return; }
      const row = e.target.closest('.frow');
      if (!row) return;
      const item = state.files.items.find((i) => i.path === row.dataset.path);
      if (!item) return;
      if (item.dir) {
        openPath(item.path);
      } else if (item.link) {
        toast('这是快捷链接，已跳过');
      }
    });

    els.fileList.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.frow');
      if (!row) return;
      const item = state.files.items.find((i) => i.path === row.dataset.path);
      if (item && !item.dir && !item.link) reveal(item.path);
    });

    els.appSearch.addEventListener('input', () => {
      state.apps.query = els.appSearch.value;
      renderApps();
    });

    els.appList.addEventListener('click', (e) => {
      const row = e.target.closest('.arow');
      const target = row?.dataset.open;
      if (target) reveal(target);
    });

    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'ArrowLeft' && state.tab === 'files' && state.files.parent) {
        e.preventDefault();
        openPath(state.files.parent);
      }
    });

    els.appSearch.addEventListener('keydown', (e) => e.stopPropagation());

    els.bigBtn.addEventListener('click', startBig);

    els.bigDiskSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-root]');
      if (!btn || state.big.data?.running) return;
      state.big.root = btn.dataset.root;
      buildBigDisks();
    });

    els.bigList.addEventListener('click', (e) => {
      const open = e.target.closest('.reveal-btn');
      if (open) { reveal(open.dataset.path); return; }
      const row = e.target.closest('.brow');
      if (!row) return;
      reveal(row.dataset.path);
    });

    /* -------- 清理 -------- */

    els.cleanList.addEventListener('change', (e) => {
      const input = e.target.closest('input[data-id]');
      if (input) setCleanSel(input.dataset.id, input.checked);
    });

    els.cleanList.addEventListener('click', (e) => {
      const open = e.target.closest('.copen');
      if (open) { reveal(open.dataset.path); return; }
      if (e.target.closest('.cbox')) return;
      const card = e.target.closest('.ccard');
      if (card) setCleanSel(card.dataset.id, !state.clean.sel.has(card.dataset.id));
    });

    els.cleanRun.addEventListener('click', openCleanModal);
    els.cleanRescan.addEventListener('click', () => loadClean());
    els.cleanCancel.addEventListener('click', closeCleanModal);
    els.cleanConfirm.addEventListener('click', doClean);
    els.cleanModal.addEventListener('click', (e) => { if (e.target === els.cleanModal) closeCleanModal(); });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.cleanModal.hidden) closeCleanModal();
    });
  }

  /* ---------------- 启动 ---------------- */

  bind();
  loadDisks();
  setBigEmpty('选一块磁盘，点「开始扫描」找找谁最占地方');
  requestAnimationFrame(movePill);

  setInterval(() => { fetch('/api/ping').catch(() => {}); }, 20_000);
  window.addEventListener('pagehide', () => { navigator.sendBeacon('/api/bye'); });
})();
