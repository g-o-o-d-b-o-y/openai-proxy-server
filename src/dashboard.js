export const faviconSvg = String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#15213d"/><stop offset="1" stop-color="#0b1020"/></linearGradient></defs>
<rect width="64" height="64" rx="14" fill="url(#bg)" stroke="#25314b" stroke-width="2"/>
<path d="M22 15h20a11 11 0 0 1 0 22H30v12h-8z" fill="#e7ecf5"/>
<circle cx="47" cy="48" r="6" fill="#4ade80"/>
</svg>`;

const style = `
:root{color-scheme:dark;--bg:#0b1020;--panel:#10182a;--line:#25314b;--line2:#2b3855;--text:#e7ecf5;--muted:#95a3ba;--ok:#77e5a8;--warn:#fbbf24;--bad:#ff8b8b;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at top,#15213d 0,#0b1020 45%);min-height:100vh;display:flex;flex-direction:column}
main{max-width:1200px;margin:0 auto;padding:28px;width:100%;flex:1}
header{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:20px}
.title{font-size:24px;font-weight:750;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:13px}
.pill{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border:1px solid var(--line2);border-radius:999px;background:#111a2d;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:0 8px 30px #0003}
.metric b{font-size:24px;display:block;margin-top:8px;font-variant-numeric:tabular-nums}
.metric span{color:var(--muted);font-size:12px}
.wide{grid-column:1/-1;margin-top:12px;display:flex;flex-direction:column;padding:0;overflow:hidden}
.listbar{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;padding:16px 16px 8px}
.ltitle .h{font-size:14px;font-weight:650;color:var(--text)}
.ltitle .s{color:var(--muted);font-size:12px;margin-top:2px;font-variant-numeric:tabular-nums}
.ltools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:2px 16px 12px}
.chip{display:inline-flex;align-items:center;min-height:34px;gap:6px;border:1px solid var(--line);background:#0d1424;color:var(--muted);border-radius:999px;padding:6px 12px;font-size:12px;cursor:pointer;transition:.15s;font-family:inherit;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.chip:hover{border-color:var(--line2);color:var(--text)}
.chip.active{border-color:#3b82f6;color:#bfdbfe;background:#16233c}
.chip .cnt{background:#1b2740;border-radius:999px;padding:1px 7px;font-variant-numeric:tabular-nums}
.chip.active .cnt{background:#2b4a7a;color:#e0ecff}
.chip.fchip{border-color:#3d5a8f;background:#14233c;color:#cfe0ff;max-width:100%}
.chip.fchip .flabel{color:#8fb3ff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;flex:0 0 auto}
.chip.fchip .fval{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:220px}
.chip.fchip .x{margin-left:2px;color:#8fb3ff;flex:0 0 auto}
.chipsep{flex:0 0 1px;width:1px;align-self:stretch;margin:4px 2px;background:var(--line2)}
.ltools .pbtn{background:#12253f;border-color:#1d5d8f;color:#bfdbfe;flex:0 0 auto}
input#search,.ctl{background:#0d1424;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:8px 12px;font-size:13px;outline:none;font-family:inherit}
input#search{width:210px}
input#search:focus,.ctl:focus{border-color:#3b82f6;box-shadow:0 0 0 3px #3b82f622}
.ctl{width:150px;cursor:pointer}
.groups{display:flex;flex-direction:column;margin:0 16px 10px;border:1px solid var(--line);border-radius:12px;background:#0d1424}
.ghead{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px solid var(--line);color:var(--muted);font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.glist{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px;padding:8px}
.grow{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;border:1px solid transparent;cursor:pointer;transition:.12s;min-width:0;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.grow:hover{background:#152238;border-color:var(--line2)}
.grow.active{background:#16233c;border-color:#3b82f6}
.gname{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.gcount{font-size:12px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums}
.gbar{flex:0 0 60px;height:6px;border-radius:99px;background:#1b2740;overflow:hidden}
.gbar i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#22d3ee);border-radius:99px}
.gtok{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.gcost{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.tablewrap{overflow:auto;max-height:58vh;-webkit-overflow-scrolling:touch;border-top:1px solid var(--line)}
.tablewrap.empty-state{display:flex;align-items:center;justify-content:center;min-height:340px;max-height:none}
table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:960px}
th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #202c44;white-space:nowrap;font-variant-numeric:tabular-nums}
th{color:var(--muted);font-weight:600;position:sticky;top:0;background:#0f1728;z-index:1;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
tbody tr{transition:background .12s}
tbody tr:hover{background:#131d33}
td.c-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;max-width:320px;overflow:hidden;text-overflow:ellipsis}
td.c-model{max-width:220px;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
td.c-ip{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.c-quota{min-width:86px;text-align:center}
.qbar{display:inline-flex;align-items:center;gap:0;min-width:64px;max-width:120px;height:16px;background:#1b2740;border-radius:99px;overflow:hidden;position:relative;padding:0 6px;font-variant-numeric:tabular-nums}
.qbar i{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#22d3ee);border-radius:99px;position:absolute;left:0;top:0}
.qbar b{position:relative;z-index:1;font-size:10px;font-weight:700;color:#eaf2ff;white-space:nowrap;background:rgba(11,16,32,.55);border-radius:99px;padding:0 5px}
.qbar.low i{background:linear-gradient(90deg,#ef4444,#f97316)}
.qbar.mid i{background:linear-gradient(90deg,#f59e0b,#facc15)}
.badge{display:inline-block;border-radius:999px;padding:2px 9px;font-size:10.5px;font-weight:700;letter-spacing:.05em}
.badge.llm{background:#19305a;color:#8fc3ff}
.badge.tts{background:#312055;color:#c9b0ff}
.badge.stt{background:#103c3a;color:#7ee8d8}
.st{display:inline-block;min-width:34px;text-align:center;border-radius:6px;padding:2px 6px;font-size:11px;font-weight:700}
.st.ok{background:#123326;color:var(--ok)}
.st.warn{background:#3a2c12;color:var(--warn)}
.st.bad{background:#3a1622;color:var(--bad)}
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:var(--muted);padding:40px 20px;max-width:420px}
.empty svg{opacity:.55}
.empty b{color:#c8d4ea;font-size:16px;font-weight:650}
.empty span{font-size:13px;line-height:1.5}
.pager{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px 16px;border-top:1px solid var(--line)}
.pbtn{border:1px solid var(--line2);background:#0d1424;color:var(--text);border-radius:9px;padding:7px 13px;font-size:13px;cursor:pointer;transition:.15s;font-family:inherit;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.pbtn:hover:not(:disabled){border-color:#3b82f6;color:#bfdbfe}
.pbtn:disabled{opacity:.4;cursor:not-allowed}
.pbtn.accent{background:#123552;border-color:#1d5d8f}
.pbtn.tiny{padding:4px 9px;font-size:12px;border-color:transparent;background:transparent}
.pinfo{color:var(--muted);font-size:12.5px;flex:1;min-width:120px;font-variant-numeric:tabular-nums}
select#pageSize{background:#0d1424;border:1px solid var(--line2);color:var(--text);border-radius:9px;padding:7px 8px;font-size:13px;outline:none;font-family:inherit}
[hidden]{display:none!important}
.hidden{display:none!important}
footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:18px 28px;color:#5f6d85;font-size:12px;max-width:1200px;margin:0 auto;width:100%}
.live{width:8px;height:8px;border-radius:50%;background:var(--ok);display:inline-block;box-shadow:0 0 0 5px #4ade8020}
@media(max-width:820px){main{padding:20px 16px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metric b{font-size:20px}.listbar{flex-direction:column;align-items:stretch}.ltools{justify-content:flex-start;width:100%}}
@media(max-width:620px){.grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.card{padding:12px;border-radius:12px}.metric b{font-size:18px}.metric span{font-size:11px}.listbar{gap:10px;padding:14px 12px 10px}.ltools{flex-wrap:wrap;width:100%}.ltools #search{flex:1 1 100%;font-size:16px}.ltools .ctl{flex:1 1 100%;font-size:16px}.ltools .pbtn{flex:0 0 auto}.chips{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding:0 12px 10px}.chips::-webkit-scrollbar{display:none}.chip.fchip .fval{max-width:150px}th,td{padding:8px 6px;font-size:12px}.tablewrap{max-height:52vh}.pager{padding:10px 12px 12px}.pbtn{flex:1;min-height:40px;padding:8px 10px}.pinfo{flex-basis:100%;text-align:center}.grow{min-height:38px}.glist{grid-template-columns:1fr}thead th.c-model,td.c-model,thead th.c-out,td.c-out{display:none}header{align-items:flex-start;flex-direction:column;gap:10px}.title{font-size:20px}.pill{align-self:flex-end}.tablewrap.empty-state{min-height:240px}.empty svg{width:52px;height:52px}.groups{margin:0 12px 8px}}
@media(max-width:380px){main{padding:14px 10px}.card{padding:10px;border-radius:10px}.metric b{font-size:16px}.title{font-size:18px}.grid{gap:6px}.sub{font-size:12px}}
`;

const body = `
<header><div><div class="title">OpenAI Proxy Server</div><div class="sub">LLM · TTS · STT · live request telemetry</div></div><div class="pill"><span class="live"></span><span id="conn">connecting</span></div></header>
<section class="grid">
<div class="card metric"><span>Requests</span><b id="requests">0</b></div>
<div class="card metric"><span>Active</span><b id="active">0</b></div>
<div class="card metric"><span>Errors</span><b id="errors">0</b></div>
<div class="card metric"><span>Tokens</span><b id="tokens">0</b></div>
<div class="card metric"><span>Bytes out</span><b id="bytes">0 B</b></div>
<div class="card metric"><span>Cost reported</span><b id="cost">$0.0000</b></div>
</section>
<section class="card wide">
<div class="listbar">
<div class="ltitle"><div class="h">Recent requests</div><div class="s" id="resultInfo">Newest first · 0 logs</div></div>
<div class="ltools">
<button class="pbtn tiny hidden" id="clearAll" title="Clear all filters">Clear all <span id="clearAllCount"></span></button>
<input id="search" type="search" placeholder="Filter results…" aria-label="Search logs" autocomplete="off" spellcheck="false" />
<select class="ctl" id="groupBy" aria-label="Group requests by" title="Group requests by a field; click a group to filter">
<option value="none">Group by…</option>
<option value="ip">Group by IP</option>
<option value="model">Group by model</option>
<option value="method">Group by method</option>
<option value="status">Group by status</option>
<option value="kind">Group by type</option>
<option value="path">Group by path</option>
<option value="hour">Group by hour</option>
</select>
</div>
</div>
<div class="chips" id="chips"></div>
<div class="groups" id="groups" hidden>
<div class="ghead"><span id="groupsTitle">Groups</span><button class="pbtn tiny" id="groupsClose" title="Close grouping">✕</button></div>
<div class="glist" id="groupsList"></div>
</div>
<div class="tablewrap empty-state" id="tableWrap">
<div class="empty" id="empty">
<svg viewBox="0 0 64 64" width="70" height="70" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 26l22-13 22 13v22L32 48 10 35z"/><path d="M10 26l22 13 22-13"/></svg>
<b id="emptyTitle">No requests yet</b>
<span id="emptySub">Requests proxied through this server will show up here in real time.</span>
</div>
<table id="logTable" hidden><thead><tr><th>Time</th><th>IP</th><th>Type</th><th>Method</th><th>Path</th><th class="c-model">Model</th><th>Status</th><th>Latency</th><th>Tokens</th><th class="c-quota">Quota</th><th class="c-out">Out</th></tr></thead><tbody id="rows"></tbody></table>
</div>
<div class="pager" id="pager"><button class="pbtn" id="prevBtn">‹ Prev</button><span class="pinfo" id="pageInfo">Page 1 of 1</span><button class="pbtn" id="nextBtn">Next ›</button><select id="pageSize" aria-label="Rows per page"><option>20</option><option selected>50</option><option>100</option></select><button class="pbtn accent hidden" id="latestBtn">Go to latest</button></div>
</section>
`;

const script = String.raw`
const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const bytes = (n) => { n = Number(n || 0); if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; };
const dur = (ms) => { ms = Number(ms) || 0; if (ms < 1000) return ms + ' ms'; if (ms < 60000) return (ms / 1000).toFixed(2) + ' s'; return Math.floor(ms / 60) + 'm ' + Math.round(ms % 60) + 's'; };
const upFmt = (s) => { s = Number(s) || 0; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm ' + Math.floor(s % 60) + 's'; };
const timeFmt = (iso) => { const d = new Date(iso); const same = d.toDateString() === new Date().toDateString(); const t = d.toLocaleTimeString([], { hour12: false }); return same ? t : d.toLocaleDateString([], { month: '2-digit', day: '2-digit' }) + ' ' + t; };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kindInfo = (k) => { k = (k || 'openai').toLowerCase(); return k === 'stt' ? { label: 'STT', cls: 'stt' } : k === 'tts' ? { label: 'TTS', cls: 'tts' } : { label: 'LLM', cls: 'llm' }; };
const statusCls = (s) => !s ? 'bad' : s < 400 ? 'ok' : s < 500 ? 'warn' : 'bad';
const quotaCell = (q) => {
  if (!q) return '<span class="muted">—</span>';
  const cls = q.pct <= 15 ? ' low' : q.pct <= 40 ? ' mid' : '';
  const where = q.scope === 'ip' ? ' (IP ' + q.key + ')' : '';
  const title = 'Remaining ' + q.remaining + ' of ' + q.max + ' ' + q.metric + ' in ' + (q.windowLabel || '') + where;
  return '<span class="qbar' + cls + '" title="' + esc(title) + '"><i style="width:' + q.pct + '%"></i><b>' + q.pct + '%</b></span>';
};

const token = new URLSearchParams(location.search).get('token');
const base = location.pathname.replace(/\/$/, '');
const state = { page: 1, pageSize: 50, total: 0, kind: 'all', q: '', filters: {}, filterLabels: {}, groupBy: 'none', pendingNew: 0, lastTotal: -1 };
let lastByRoute = {};
let lastAllTotal = 0;
const KINDS = [['all', 'All'], ['openai', 'LLM'], ['tts', 'TTS'], ['stt', 'STT']];
const FIELD_NAME = { ip: 'IP', model: 'Model', method: 'Method', status: 'Status', kind: 'Type', path: 'Path', hour: 'Hour' };

function getParams(extra) {
  const p = new URLSearchParams(extra);
  p.set('kind', state.kind);
  p.set('q', state.q);
  if (p.get('limit') === null) p.set('limit', String(state.pageSize));
  if (p.get('offset') === null) p.set('offset', String((state.page - 1) * state.pageSize));
  const skipField = extra && extra.field;
  for (const [f, v] of Object.entries(state.filters)) if (f !== skipField) p.set(f, v);
  if (token) p.set('token', token);
  return p;
}

function activeFilterCount() {
  return (state.kind !== 'all' ? 1 : 0) + (state.q ? 1 : 0) + Object.keys(state.filters).length;
}

function renderChipRail() {
  const byRoute = lastByRoute || {};
  const parts = KINDS.map(([key, label]) => {
    let count = 0;
    if (key === 'all') count = (byRoute.openai && byRoute.openai.requests || 0) + (byRoute.tts && byRoute.tts.requests || 0) + (byRoute.stt && byRoute.stt.requests || 0);
    else count = (byRoute[key] && byRoute[key].requests) || 0;
    return '<button class="chip' + (state.kind === key ? ' active' : '') + '" data-kind="' + key + '">' + label + '<span class="cnt">' + fmt(count) + '</span></button>';
  });
  const filters = Object.entries(state.filters);
  if (filters.length) parts.push('<span class="chipsep" aria-hidden="true"></span>');
  for (const [field, value] of filters) {
    const label = FIELD_NAME[field] || field;
    parts.push('<button class="chip fchip" data-field="' + esc(field) + '" title="' + esc(label + ' : ' + value) + '">' +
      '<span class="flabel">' + esc(label) + '</span><span class="fval">' + esc(state.filterLabels[field] || value) + '</span><span class="x">✕</span></button>');
  }
  $('chips').innerHTML = parts.join('');
  $('clearAllCount').textContent = activeFilterCount() > 1 ? '(' + activeFilterCount() + ')' : '';
  $('clearAll').classList.toggle('hidden', activeFilterCount() === 0);
}

function renderGroups(data) {
  const box = $('groups');
  if (state.groupBy === 'none' || !data || !data.groups || !data.groups.length) { box.hidden = true; return; }
  box.hidden = false;
  if (data.field === 'hour' && state.groupBy === 'hour') {
    $('groupsTitle').textContent = 'Last ' + data.groups.length + ' hour' + (data.groups.length === 1 ? '' : 's') + ' (newest first)';
  } else {
    $('groupsTitle').textContent = 'Top ' + (FIELD_NAME[data.field] || data.field);
  }
  const totalCount = data.groups.reduce((a, g) => a + (g.count || 0), 0) || 1;
  $('groupsList').innerHTML = data.groups.map((g) => {
    const pct = Math.max(2, Math.round((g.count / totalCount) * 100));
    const activeKey = data.field === 'kind' ? state.kind : state.filters[data.field];
    const active = activeKey === g.key ? ' active' : '';
    return '<div class="grow' + active + '" data-field="' + esc(data.field) + '" data-key="' + esc(g.key) + '" data-label="' + esc(g.label || g.key) + '" title="Filter by ' + esc(FIELD_NAME[data.field] || data.field) + ' ' + esc(g.label || g.key) + '">' +
      '<span class="gname">' + esc(g.label || g.key) + '</span>' +
      '<span class="gcount">' + fmt(g.count) + '</span>' +
      '<span class="gbar"><i style="width:' + pct + '%"></i></span>' +
      '<span class="gtok">' + fmt(g.totalTokens) + ' tok</span>' +
      '<span class="gcost">$' + Number(g.cost || 0).toFixed(4) + '</span></div>';
  }).join('');
}

function renderLogs(logs) {
  $('rows').innerHTML = logs.map((l) => {
    const k = kindInfo(l.kind);
    const err = l.error ? ' title="' + esc(l.error) + '"' : '';
    return '<tr' + err + '>' +
      '<td title="' + esc(new Date(l.time).toLocaleString()) + '">' + timeFmt(l.time) + '</td>' +
      '<td class="c-ip">' + esc(l.clientIp || '') + '</td>' +
      '<td><span class="badge ' + k.cls + '">' + k.label + '</span></td>' +
      '<td>' + esc(l.method || '') + '</td>' +
      '<td class="c-path" title="' + esc(l.path || '') + '">' + esc(l.path || '') + '</td>' +
      '<td class="c-model" title="' + esc(l.model || '') + '">' + esc(l.model || '—') + '</td>' +
      '<td><span class="st ' + statusCls(l.status) + '">' + (l.status || 'ERR') + '</span></td>' +
      '<td>' + dur(l.durationMs) + '</td>' +
      '<td>' + fmt(l.usage ? l.usage.totalTokens : 0) + '</td>' +
      '<td class="c-quota">' + quotaCell(l.quota) + '</td>' +
      '<td class="c-out">' + bytes(l.bytesOut) + '</td>' +
      '</tr>';
  }).join('');
}

function renderEmpty() {
  const filtering = state.kind !== 'all' || state.q !== '' || Object.keys(state.filters).length > 0;
  $('logTable').hidden = state.total === 0;
  $('empty').hidden = state.total !== 0;
  $('tableWrap').classList.toggle('empty-state', state.total === 0);
  if (state.total === 0) {
    $('emptyTitle').textContent = filtering ? 'No matches' : 'No requests yet';
    $('emptySub').textContent = filtering ? 'Nothing matches the current filters. Try clearing the search, chips or grouping.' : 'Requests proxied through this server will show up here in real time.';
  }
}

function renderPager() {
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (state.page > pages) state.page = pages;
  $('prevBtn').disabled = state.page <= 1;
  $('nextBtn').disabled = state.page >= pages;
  $('pageInfo').textContent = 'Page ' + state.page + ' of ' + pages + ' · ' + fmt(state.total) + ' logs';
  const show = state.pendingNew > 0 && state.page > 1;
  $('latestBtn').classList.toggle('hidden', !show);
  $('latestBtn').textContent = (state.pendingNew > 0 ? fmt(state.pendingNew) + ' new · ' : '') + 'Go to latest';
}

function renderResultInfo() {
  const n = activeFilterCount();
  if (n === 0) {
    $('resultInfo').textContent = 'Newest first · ' + fmt(state.total) + ' log' + (state.total === 1 ? '' : 's');
  } else {
    const all = Math.max(state.total, lastAllTotal || state.total);
    $('resultInfo').textContent = 'Showing ' + fmt(state.total) + ' of ' + fmt(all) + ' · ' + n + ' filter' + (n === 1 ? '' : 's');
  }
}

async function loadLogs() {
  try {
    const res = await fetch(base + '/api/logs?' + getParams({}).toString());
    const data = await res.json();
    if (Array.isArray(data)) { state.total = data.length; renderLogs(data); }
    else { state.total = data.total || 0; renderLogs(data.logs || []); }
  } catch {}
  renderPager();
  renderEmpty();
  renderResultInfo();
  renderChipRail();
}

async function loadGroups() {
  if (state.groupBy === 'none') { $('groups').hidden = true; return; }
  try {
    // Hour grouping shows the most recent 24 hours; other groupings show Top N.
    const groupLimit = state.groupBy === 'hour' ? '24' : '14';
    const p = getParams({ field: state.groupBy, limit: groupLimit });
    if (state.filters[state.groupBy]) p.delete(state.groupBy);
    const data = await (await fetch(base + '/api/groups?' + p.toString())).json();
    renderGroups(Array.isArray(data) ? null : data);
  } catch {}
}

let refreshTimer = null;
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { loadLogs(); loadGroups(); }, 400); }

function render(s) {
  $('requests').textContent = fmt(s.totals.requests);
  $('active').textContent = fmt(s.active);
  $('errors').textContent = fmt(s.totals.errors);
  $('tokens').textContent = fmt(s.totals.totalTokens);
  $('bytes').textContent = bytes(s.totals.bytesOut);
  $('cost').textContent = '$' + Number(s.totals.cost || 0).toFixed(4);
  $('up').textContent = upFmt(s.uptimeSeconds);
  lastByRoute = s.byRoute || {};
  lastAllTotal = s.totals.requests;
  renderChipRail();
  renderResultInfo();
  if (s.totals.requests !== state.lastTotal) {
    if (state.lastTotal >= 0 && s.totals.requests > state.lastTotal) { state.pendingNew = (state.pendingNew || 0) + (s.totals.requests - state.lastTotal); renderPager(); }
    state.lastTotal = s.totals.requests;
  }
  scheduleRefresh();
}

const input = $('search');
input.addEventListener('input', () => { clearTimeout(input._t); input._t = setTimeout(() => { state.q = input.value.trim().toLowerCase(); state.page = 1; state.pendingNew = 0; loadLogs(); loadGroups(); }, 300); });
$('chips').addEventListener('click', (e) => {
  const kindBtn = e.target.closest('[data-kind]');
  if (kindBtn) {
    const key = kindBtn.getAttribute('data-kind');
    state.kind = state.kind === key ? 'all' : key;
  } else {
    const fchip = e.target.closest('.fchip');
    if (!fchip) return;
    delete state.filters[fchip.getAttribute('data-field')];
  }
  state.page = 1; state.pendingNew = 0;
  renderChipRail();
  loadLogs(); loadGroups();
});
$('clearAll').addEventListener('click', () => {
  state.kind = 'all'; state.q = ''; state.filters = {}; state.filterLabels = {}; state.page = 1; state.pendingNew = 0;
  input.value = '';
  renderChipRail();
  loadLogs(); loadGroups();
});
$('groupsList').addEventListener('click', (e) => {
  const row = e.target.closest('.grow'); if (!row) return;
  const field = row.getAttribute('data-field');
  const key = row.getAttribute('data-key');
  const label = row.getAttribute('data-label') || key;
  if (field === 'kind') {
    // Type grouping maps onto the same kind chip - one source of truth.
    state.kind = state.kind === key ? 'all' : key;
  } else if (state.filters[field] === key) {
    delete state.filters[field];
    delete state.filterLabels[field];
  } else {
    state.filters[field] = key;
    state.filterLabels[field] = label;
  }
  state.page = 1; state.pendingNew = 0;
  renderChipRail();
  loadLogs(); loadGroups();
});
$('groupBy').addEventListener('change', (e) => { state.groupBy = e.target.value; state.page = 1; loadLogs(); loadGroups(); });
$('groupsClose').addEventListener('click', () => { state.groupBy = 'none'; $('groupBy').value = 'none'; $('groups').hidden = true; });
$('pageSize').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 1; loadLogs(); });
$('prevBtn').addEventListener('click', () => { if (state.page > 1) { state.page--; loadLogs(); } });
$('nextBtn').addEventListener('click', () => { if (state.page < Math.ceil(state.total / state.pageSize)) { state.page++; loadLogs(); } });
$('latestBtn').addEventListener('click', () => { state.page = 1; state.pendingNew = 0; loadLogs(); });

const es = new EventSource(base + '/events' + (token ? '?token=' + encodeURIComponent(token) : ''));
es.onopen = () => { $('conn').textContent = 'live'; };
es.onerror = () => { $('conn').textContent = 'reconnecting'; };
es.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.snapshot) render(d.snapshot); } catch {} };

loadLogs();
`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="theme-color" content="#0b1020" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<title>OpenAI Proxy Server</title>
<style>
${style}
</style>
</head>
<body><main>
${body}
</main>
<footer><span>OpenAI Proxy Server</span><span>Uptime <b id="up">–</b></span><span>Telemetry stays local</span></footer>
<script>
${script}
</script>
</body></html>`;

const GROUP_FIELDS = new Set(['ip', 'model', 'method', 'status', 'kind', 'path', 'hour']);

function applyLogFilters(logs, { kind, q, ip, model, method, status, path, hour } = {}) {
  let out = logs.slice();
  if (kind && kind !== 'all') out = out.filter((log) => (log.kind || 'openai') === kind);
  if (ip) out = out.filter((log) => String(log.clientIp || '').toLowerCase() === ip);
  if (model) out = out.filter((log) => String(log.model || '').toLowerCase() === model);
  if (method) out = out.filter((log) => String(log.method || '').toUpperCase() === method);
  if (status) out = out.filter((log) => String(log.status || '') === status);
  if (path) out = out.filter((log) => String(log.path || '/').toLowerCase() === path);
  if (hour) out = out.filter((log) => String(log.time || '').slice(0, 13).toLowerCase() === hour);
  if (q) out = out.filter((log) => [log.method, log.path, log.model, log.clientIp, log.status, log.error]
    .some((value) => value != null && String(value).toLowerCase().includes(q)));
  return out;
}

function readLogFilterParams(url) {
  return {
    kind: String(url.searchParams.get('kind') || '').toLowerCase(),
    q: String(url.searchParams.get('q') || '').trim().toLowerCase(),
    ip: String(url.searchParams.get('ip') || '').trim().toLowerCase(),
    model: String(url.searchParams.get('model') || '').trim().toLowerCase(),
    method: String(url.searchParams.get('method') || '').trim().toUpperCase(),
    status: String(url.searchParams.get('status') || '').trim(),
    path: String(url.searchParams.get('path') || '').trim().toLowerCase(),
    hour: String(url.searchParams.get('hour') || '').trim().toLowerCase()
  };
}

export function serveDashboard(req, res, { config, stats }) {
  const url = new URL(req.url, 'http://localhost');
  const base = config.dashboardPath;
  if (!url.pathname.startsWith(base)) return false;

  if (!config.dashboard) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'dashboard_disabled' }));
    return true;
  }

  if (config.dashboardToken) {
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
    if (auth !== config.dashboardToken) {
      res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'dashboard_unauthorized', hint: 'Use ?token=... or Authorization: Bearer ...' }));
      return true;
    }
  }

  if (url.pathname === base || url.pathname === base + '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page);
    return true;
  }

  if (url.pathname === base + '/api/stats') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(stats.snapshot()));
    return true;
  }

  if (url.pathname === base + '/api/logs') {
    const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '', 10) || 50));
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || '', 10) || 0);
    const filters = readLogFilterParams(url);
    const hasParams = Object.values(filters).some(Boolean) || url.searchParams.has('limit') || url.searchParams.has('offset');

    const reversed = applyLogFilters(stats.logs, filters).reverse();

    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    if (hasParams) {
      res.end(JSON.stringify({ total: reversed.length, logs: reversed.slice(offset, offset + limit) }));
    } else {
      res.end(JSON.stringify(reversed.slice(offset, offset + limit)));
    }
    return true;
  }

  if (url.pathname === base + '/api/groups') {
    const field = String(url.searchParams.get('field') || 'ip').toLowerCase();
    if (!GROUP_FIELDS.has(field)) {
      res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'invalid_group_field', fields: [...GROUP_FIELDS] }));
      return true;
    }
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '', 10) || 12));
    const filtered = applyLogFilters(stats.logs, readLogFilterParams(url));

    const map = new Map();
    for (const log of filtered) {
      let key;
      if (field === 'ip') key = log.clientIp || '(none)';
      else if (field === 'model') key = log.model || '(none)';
      else if (field === 'method') key = log.method || '(none)';
      else if (field === 'status') key = String(log.status || 'ERR');
      else if (field === 'kind') key = log.kind || 'openai';
      else if (field === 'path') key = log.path || '/';
      else key = log.time.slice(0, 13);

      const entry = map.get(key) || { key, label: key, count: 0, totalTokens: 0, cost: 0, audioSeconds: 0, bytesOut: 0, last: '' };
      entry.count += 1;
      entry.totalTokens += log.usage?.totalTokens || 0;
      entry.cost += log.usage?.cost || 0;
      entry.audioSeconds += log.usage?.audioSeconds || 0;
      entry.bytesOut += log.bytesOut || 0;
      if (log.time > entry.last) entry.last = log.time;
      map.set(key, entry);
    }

    let groups = [...map.values()];
    for (const group of groups) delete group.last;
    if (field === 'hour') groups.sort((a, b) => b.key.localeCompare(a.key) || a.count - b.count);
    else groups.sort((a, b) => (b.count - a.count) || (b.bytesOut - a.bytesOut));
    groups = groups.slice(0, limit);
    if (field === 'hour') for (const group of groups) group.label = group.key.replace('T', ' ') + ':00';

    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ field, total: filtered.length, groups }));
    return true;
  }

  if (url.pathname === base + '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no'
    });
    res.write(': connected\n\n');
    const unsubscribe = stats.subscribe(chunk => res.write(chunk));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
    heartbeat.unref?.();
    req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
    return true;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
  return true;
}

export function serveFavicon(req, res, { config }) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/favicon.ico' && url.pathname !== '/favicon.svg') return false;
  if (config.dashboard) {
    res.writeHead(200, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-length': Buffer.byteLength(faviconSvg),
      'cache-control': 'public, max-age=86400'
    });
    res.end(faviconSvg);
  } else {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
  }
  return true;
}