// Shared UI theme and client runtime.
//
// Design rules: pure black canvas, near-black surfaces, one neutral accent,
// status colors only for state. Layout is density-first: compact rows, two-line
// table cells, and explanations in a fast custom tooltip (data-tip) instead of
// inline text or native title attributes.

export const baseCss = `
:root{
  color-scheme:dark;
  --bg:#000;--surface:#0a0a0b;--surface-2:#111113;--surface-3:#17171a;
  --border:#1e1e22;--border-strong:#2a2a30;
  --text:#fafafa;--muted:#a1a1aa;--faint:#71717a;
  --ok:#3ecf8e;--warn:#e0b04d;--bad:#f26d6d;
  --radius:11px;
}
*{box-sizing:border-box}
html{scrollbar-color:#2a2a30 transparent;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:12.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--text);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
h1,h2,h3{margin:0;font-weight:600;letter-spacing:-.02em}
p{margin:0}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:1180px;margin:0 auto;padding:16px 18px 56px}
.top{position:sticky;top:0;z-index:20;background:rgba(0,0,0,.85);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.top-inner{max-width:1180px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:9px 18px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:8px;font-weight:650;font-size:13.5px;color:var(--text)}
.brand:hover{text-decoration:none}
.brand .mark{width:21px;height:21px;border-radius:6px;background:var(--text);color:#000;display:grid;place-items:center;font-size:11px;font-weight:800}
.brand small{display:block;font-weight:450;font-size:9.5px;color:var(--faint);letter-spacing:.06em;text-transform:uppercase}
.spacer{flex:1}
nav.tabs{display:flex;gap:1px;flex-wrap:wrap}
.tab{padding:5px 10px;border-radius:7px;color:var(--muted);font-weight:550;border:0;background:none;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.tab:hover{color:var(--text);background:var(--surface-2);text-decoration:none}
.tab.active{color:var(--text);background:var(--surface-3)}

/* layout */
.grid{display:grid;gap:10px}
.cols{grid-template-columns:repeat(auto-fit,minmax(138px,1fr))}
.cols4{grid-template-columns:repeat(4,minmax(0,1fr))}
.cols2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.split{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)}
.card.pad0{overflow:hidden}
.card .hd{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 11px;border-bottom:1px solid var(--border);min-height:34px}
.card .hd h3{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:650}
.card .bd{padding:11px}
.page-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0 8px;flex-wrap:wrap}
.page-head h1{font-size:16px}
.page-head .sub{color:var(--muted);font-size:11px;margin-top:1px}

/* metrics */
.metric{display:flex;flex-direction:column;gap:1px;padding:9px 11px}
.metric .lbl{display:flex;align-items:center;gap:4px;color:var(--muted);font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.metric b{font-size:16px;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.metric small{color:var(--faint);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile{background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:7px 9px}
.tile .k{display:flex;align-items:center;gap:4px;color:var(--faint);font-size:9.5px;text-transform:uppercase;letter-spacing:.06em}
.tile .v{font-size:13.5px;font-weight:650;margin-top:1px;font-variant-numeric:tabular-nums}
.stat-inline{display:flex;gap:7px;flex-wrap:wrap}
.stat-inline .tile{flex:1;min-width:86px}

/* tooltips */
.hint{display:inline-grid;place-items:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--border-strong);color:var(--faint);font-size:8.5px;font-weight:700;font-style:normal;cursor:help;flex:0 0 auto;line-height:1;vertical-align:middle}
.hint:hover,.hint:focus-visible{color:var(--text);border-color:#52525b;outline:none}
.tooltip{position:fixed;z-index:300;max-width:250px;background:#151518;border:1px solid var(--border-strong);border-radius:8px;padding:6px 9px;font-size:11.5px;line-height:1.45;color:#e4e4e7;box-shadow:0 12px 32px rgba(0,0,0,.75);pointer-events:none}
.tooltip[hidden]{display:none}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:6px 10px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text);font:inherit;font-weight:550;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s}
.btn:hover{background:var(--surface-3);border-color:#3a3a42}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn.primary{background:var(--text);border-color:var(--text);color:#000}
.btn.primary:hover{background:#e4e4e7}
.btn.danger{color:var(--bad);border-color:#3a2225}
.btn.danger:hover{background:#1b1113;border-color:#5c343a}
.btn.ghost{background:none;border-color:transparent;color:var(--muted)}
.btn.ghost:hover{color:var(--text);background:var(--surface-2)}
.btn.sm{padding:3px 8px;font-size:11.5px;border-radius:7px}

/* forms */
input,.select,textarea{background:var(--bg);border:1px solid var(--border-strong);color:var(--text);border-radius:8px;padding:6px 9px;font:inherit;font-size:12.5px;outline:none;width:100%}
input::placeholder,textarea::placeholder{color:var(--faint)}
input:focus,textarea:focus,.select:focus{border-color:#52525b;box-shadow:0 0 0 3px rgba(250,250,250,.07)}
label.f{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--muted)}
label.f .lbl{display:flex;align-items:center;gap:4px;color:var(--text);font-weight:550}
label.f small{color:var(--faint);font-size:11px;line-height:1.4}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.formgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;padding:12px}

/* disclosure */
details.more{border:1px solid var(--border);border-radius:9px;background:var(--surface);overflow:hidden}
details.more>summary{cursor:pointer;list-style:none;padding:8px 11px;color:var(--muted);font-size:11.5px;display:flex;align-items:center;gap:6px;user-select:none}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::before{content:"+";color:var(--faint);font-weight:700}
details.more[open]>summary::before{content:"−"}
details.more>summary:hover{color:var(--text);background:var(--surface-2)}
details.more>summary .count{margin-left:auto;color:var(--faint);font-size:10.5px;font-weight:500}
details.more>.body{padding:0 11px 11px;display:flex;flex-direction:column;gap:10px}
details.more[open]>summary{border-bottom:1px solid var(--border)}

/* tables */
.toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:7px 11px}
.toolbar input{width:auto;min-width:160px;flex:1;max-width:280px}
.tablewrap{overflow:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:12px}
th{position:sticky;top:0;z-index:1;background:var(--surface);color:var(--faint);text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:650;padding:6px 9px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:6px 9px;border-bottom:1px solid var(--border);white-space:nowrap;vertical-align:middle;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--surface-2)}
.num{text-align:right}
.stack{display:flex;flex-direction:column;gap:1px;line-height:1.3}
.stack small{color:var(--faint);font-size:10.5px;font-weight:400}
.pager{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 11px;border-top:1px solid var(--border)}
.pager .muted{flex:1;min-width:110px;font-size:11.5px}

/* badges */
.badge{display:inline-block;padding:1px 7px;border-radius:99px;font-size:10px;font-weight:650;letter-spacing:.03em;background:var(--surface-3);color:var(--muted);border:1px solid var(--border-strong)}
.badge.ok{color:var(--ok);border-color:rgba(62,207,142,.3);background:rgba(62,207,142,.06)}
.badge.warn{color:var(--warn);border-color:rgba(224,176,77,.3);background:rgba(224,176,77,.06)}
.badge.bad{color:var(--bad);border-color:rgba(242,109,109,.3);background:rgba(242,109,109,.06)}
.muted{color:var(--muted)}.faint{color:var(--faint)}.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.mono{font-size:11.5px}
.trunc{max-width:210px;overflow:hidden;text-overflow:ellipsis}
.empty{padding:30px 16px;text-align:center;color:var(--muted);font-size:12px}
.empty b{display:block;color:var(--text);font-size:13px;margin-bottom:3px}

/* progress */
.bar{height:5px;border-radius:99px;background:var(--surface-3);overflow:hidden;min-width:56px}
.bar i{display:block;height:100%;border-radius:99px;background:var(--text)}
.bar i.ok{background:var(--ok)}.bar i.warn{background:var(--warn)}.bar i.bad{background:var(--bad)}
.bar-row{display:grid;grid-template-columns:96px 1fr 108px;gap:10px;align-items:center;font-size:11.5px;padding:5px 0}
.bar-val{text-align:right;color:var(--muted);font-size:10.5px}

/* secret reveal */
.secret{display:flex;gap:7px;align-items:center;background:var(--bg);border:1px dashed var(--border-strong);border-radius:9px;padding:7px 9px}
.secret code{flex:1;overflow:auto;white-space:nowrap;font-size:11.5px}

/* hero */
.hero{display:flex;flex-direction:column;gap:11px;padding:28px 0 18px;max-width:620px}
.hero h1{font-size:clamp(22px,3.6vw,30px);letter-spacing:-.035em;line-height:1.14}
.hero p{color:var(--muted);font-size:13px}
.cta{display:flex;gap:8px;flex-wrap:wrap;padding-top:2px}
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid var(--border-strong);border-radius:99px;color:var(--muted);font-size:10.5px;width:max-content}
.dot{width:6px;height:6px;border-radius:50%;background:var(--ok);display:inline-block}
.dot.off{background:var(--faint)}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:20px}
.step{display:flex;gap:9px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.step .n{width:19px;height:19px;border-radius:6px;background:var(--surface-3);color:var(--muted);display:grid;place-items:center;font-size:10px;font-weight:700;flex:0 0 auto}
.step b{display:flex;align-items:center;gap:4px;font-size:12px;font-weight:600}
.step span{color:var(--faint);font-size:11px;display:block;margin-top:1px}

/* code */
.pre{background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:10px 12px;overflow:auto;font-size:11.5px;line-height:1.6;color:#d4d4d8}
.qs-code{margin:0;border:0;border-radius:0;background:#050506;padding:13px 14px;max-height:360px;font-size:11.5px;line-height:1.65;overflow:auto}
.qs-tabs{display:flex;gap:2px;padding:3px}
.qs-tabs .tab{padding:4px 10px;font-size:11.5px}
.qs-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-top:1px solid var(--border);font-size:11.5px}
.qs-meta .pill{cursor:pointer;border-color:var(--border);background:none}
.qs-meta .pill:hover{color:var(--text);border-color:#52525b}

/* chart */
.chart{display:flex;align-items:flex-end;gap:2px;height:72px;padding-top:4px}
.chart .cbar{flex:1;min-width:4px;background:linear-gradient(180deg,#fafafa,#52525b);border-radius:2px 2px 0 0;min-height:2px;cursor:help}
.chart .cbar:hover{background:linear-gradient(180deg,#fff,#71717a)}
.chart-labels{display:flex;gap:2px;color:var(--faint);font-size:9.5px;margin-top:4px}
.chart-labels span{flex:1;text-align:center;overflow:hidden}

/* modal */
.modal{position:fixed;inset:0;background:rgba(0,0,0,.74);display:grid;place-items:center;z-index:60;padding:14px}
.modal .box{background:var(--surface);border:1px solid var(--border-strong);border-radius:13px;width:100%;max-width:520px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.8)}
.modal .box.wide{max-width:660px}
.m-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border);flex:0 0 auto}
.m-title{font-size:13.5px;font-weight:650;letter-spacing:-.01em}
.m-sub{color:var(--muted);font-size:11.5px;margin-top:2px;overflow-wrap:anywhere}
.m-close{flex:0 0 auto;padding:2px 7px;font-size:13px;line-height:1.4}
.m-body{padding:12px;overflow:auto;display:flex;flex-direction:column;gap:10px;flex:1 1 auto}
.m-body .formgrid{padding:0}
.m-foot{display:flex;justify-content:flex-end;gap:8px;padding:9px 12px;border-top:1px solid var(--border);background:var(--surface);flex:0 0 auto}
.m-note{color:var(--faint);font-size:11.5px;line-height:1.5}
.m-section{display:flex;flex-direction:column;gap:8px}
.m-section+.m-section{margin-top:2px}
.m-section+.m-section>.sec-title{margin-top:4px}
.m-section>.sec-title{display:flex;align-items:center;gap:5px;font-size:10.5px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.m-kv{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px}
.m-kv .k{color:var(--muted)}
.m-kv .v{font-weight:550}

/* credit lots */
.credit-list{display:flex;flex-direction:column;gap:8px}
.credit{border:1px solid var(--border);border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;background:var(--surface-2)}
.credit .top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.credit .amt{font-variant-numeric:tabular-nums;font-weight:650;font-size:12px}
.credit .sub{display:flex;justify-content:space-between;gap:8px;color:var(--faint);font-size:10.5px}

/* settings */
.settings-search{display:flex;gap:8px;align-items:center;margin-bottom:10px}
.settings-search input{max-width:320px}
.setting{display:grid;grid-template-columns:minmax(130px,220px) 1fr;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)}
.setting:last-child{border-bottom:0}
.setting .name{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:550}
.setting .control{max-width:460px}
.setting .control input,.setting .control select{font-size:12px}
.setting .control textarea{font-size:11.5px}
.settings-group{margin-bottom:10px}
.settings-group>summary{cursor:pointer;padding:9px 12px;font-weight:600;font-size:12.5px;border:1px solid var(--border);border-radius:9px;background:var(--surface);list-style:none;display:flex;align-items:center;gap:8px;user-select:none}
.settings-group>summary::-webkit-details-marker{display:none}
.settings-group>summary::before{content:"›";color:var(--faint);transition:transform .15s}
.settings-group[open]>summary{border-radius:9px 9px 0 0}
.settings-group[open]>summary::before{transform:rotate(90deg)}
.settings-group>summary .count{margin-left:auto;color:var(--faint);font-size:10.5px;font-weight:500}
.settings-body{border:1px solid var(--border);border-top:0;border-radius:0 0 9px 9px;background:var(--surface);padding:3px 12px}

/* misc */
.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--surface-3);border:1px solid var(--border-strong);border-radius:9px;padding:8px 13px;font-size:12px;z-index:100;box-shadow:0 14px 40px rgba(0,0,0,.7);max-width:90vw}
.toast.bad{border-color:#5c343a;color:#ffb4b4}
.toast.ok{border-color:rgba(62,207,142,.4);color:#b5f0d2}
.hidden{display:none!important}
.foot{color:var(--faint);font-size:11px;padding:18px;max-width:1180px;margin:0 auto;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}

@media(max-width:780px){
  .wrap{padding:12px 11px 48px}
  .top-inner{padding:8px 11px;gap:7px}
  nav.tabs{overflow-x:auto;flex-wrap:nowrap;width:100%;scrollbar-width:none;order:3}
  nav.tabs::-webkit-scrollbar{display:none}
  .hero{padding:18px 0 12px}
  .mark{display:none}
  .split{grid-template-columns:1fr}
  .setting{grid-template-columns:1fr;gap:4px}
  .setting .control{max-width:none}
  .bar-row{grid-template-columns:82px 1fr;gap:8px}
  .bar-val{grid-column:2}
  .opt{display:none}
  .modal{padding:0}
  .modal .box{max-width:none;height:100%;max-height:100%;border-radius:0}
  .page-head h1{font-size:16px}
  .metric b{font-size:16px}
  .cols4{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:520px){
  .brand small{display:none}
  .cols{grid-template-columns:repeat(2,minmax(0,1fr))}
}
`;

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// Server-side hint icon; `data-tip` feeds the custom tooltip runtime.
export function hint(text) {
  return `<i class="hint" data-tip="${escapeHtml(text)}" tabindex="0" aria-label="${escapeHtml(text)}">i</i>`;
}

// Client runtime injected into every page.
export const clientCore = String.raw`
const $=(id)=>document.getElementById(id);
const esc=(v)=>String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hint=(text)=>'<i class="hint" data-tip="'+esc(text)+'" tabindex="0" aria-label="'+esc(text)+'">i</i>';
const fmt=(n)=>new Intl.NumberFormat('en-US').format(Number(n||0));
const compact=(n)=>{n=Number(n||0);const a=Math.abs(n);if(a<1000)return fmt(n);if(a<1e6)return (n/1e3).toFixed(a<1e4?1:0)+'k';if(a<1e9)return (n/1e6).toFixed(1)+'M';return (n/1e9).toFixed(1)+'B'};
const usd=(n)=>{n=Number(n||0);const a=Math.abs(n);const d=a>=1?2:a>=0.01?4:6;return '$'+n.toFixed(d)};
const usdExact=(n)=>{n=Number(n||0);return '$'+n.toFixed(6).replace(/0+$/,'').replace(/\.$/,'')||'$0'};
const bytes=(n)=>{n=Number(n||0);if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(2)+' GB'};
const dur=(ms)=>{ms=Number(ms)||0;if(ms<1000)return Math.round(ms)+'ms';if(ms<60000)return (ms/1000).toFixed(2)+'s';return Math.floor(ms/60000)+'m '+Math.round(ms%60000/1000)+'s'};
const secs=(ms)=>{ms=Number(ms)||0;return ms<1000?ms+'ms':(ms/1000).toFixed(ms<10000?1:0)+'s'};
const timeAgo=(iso)=>{if(!iso)return '—';const d=Date.parse(iso);if(!Number.isFinite(d))return '—';const s=Math.max(0,(Date.now()-d)/1000);if(s<60)return Math.floor(s)+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago'};
const dateFmt=(iso)=>{if(!iso)return '—';const d=new Date(iso);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'})};
const timeFmt=(iso)=>{if(!iso)return '—';const d=new Date(iso);return Number.isNaN(d.getTime())?'—':d.toLocaleTimeString('en-US',{hour12:false})};
const statusBadge=(s)=>{const n=Number(s||0);if(!n)return '<span class="badge bad">ERR</span>';if(n<400)return '<span class="badge ok">'+n+'</span>';if(n<500)return '<span class="badge warn">'+n+'</span>';return '<span class="badge bad">'+n+'</span>'};
const kindBadge=(k)=>{k=String(k||'llm').toLowerCase();return '<span class="badge">'+(k==='tts'?'TTS':k==='stt'?'STT':'LLM')+'</span>'};
const keyStatusBadge=(s)=>s==='active'?'<span class="badge ok">active</span>':s==='blocked'?'<span class="badge warn" data-tip="Requests rejected, dashboard still works">blocked</span>':s==='suspended'?'<span class="badge warn">suspended</span>':'<span class="badge bad">revoked</span>';
const limitBar=(leftPct,cls)=>'<span class="bar"><i class="'+cls+'" style="width:'+leftPct+'%"></i></span>';
function toast(message,kind){document.querySelectorAll('.toast').forEach((t)=>t.remove());const el=document.createElement('div');el.className='toast '+(kind||'');el.textContent=message;document.body.appendChild(el);setTimeout(()=>el.remove(),kind==='bad'?5200:2400)}
async function copy(text,label){try{await navigator.clipboard.writeText(text);toast((label||'Copied')+' to clipboard','ok')}catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('Copied','ok')}}
function showModal(html){const wrap=document.createElement('div');wrap.className='modal';wrap.innerHTML='<div class="box">'+html+'</div>';wrap.addEventListener('click',(e)=>{if(e.target===wrap)wrap.remove()});document.body.appendChild(wrap);return wrap}
function openModal(options){
  const opts=typeof options==='string'?{title:options}:options;
  const modal=showModal('<div class="m-head"><div><div class="m-title">'+esc(opts.title||'')+'</div>'+
    (opts.subtitle?'<div class="m-sub">'+esc(opts.subtitle)+'</div>':'')+'</div>'+
    '<button class="btn sm ghost m-close" aria-label="Close">✕</button></div>'+
    '<div class="m-body">'+(opts.body||'')+'</div>'+
    (opts.actions?'<div class="m-foot">'+opts.actions+'</div>':''));
  if(opts.wide)modal.querySelector('.box').classList.add('wide');
  modal.querySelector('.m-close').addEventListener('click',()=>modal.remove());
  return modal;
}
function confirmModal(options){
  const opts=typeof options==='string'?{body:options}:options;
  return new Promise((resolve)=>{
    let settled=false;
    const finish=(value)=>{if(settled)return;settled=true;modal.remove();resolve(value)};
    const modal=openModal({
      title:opts.title||'Confirm',
      subtitle:opts.subtitle||'',
      body:(opts.body||'')+(opts.details?'<div class="m-section">'+opts.details+'</div>':''),
      actions:'<button class="btn" id="confirmCancel">Cancel</button><button class="btn '+(opts.danger?'danger':'primary')+'" id="confirmOk">'+esc(opts.confirmLabel||'Confirm')+'</button>'
    });
    modal.querySelector('#confirmCancel').addEventListener('click',()=>finish(false));
    modal.querySelector('#confirmOk').addEventListener('click',()=>finish(true));
    modal.querySelector('.m-close').addEventListener('click',()=>finish(false));
    modal.addEventListener('click',(event)=>{if(event.target===modal)finish(false)});
  });
}
function storeToken(name,token){try{localStorage.setItem(name,token)}catch{}}
function loadToken(name){try{return localStorage.getItem(name)||''}catch{return ''}}
function clearToken(name){try{localStorage.removeItem(name)}catch{}}
function fragmentToken(){const m=(location.hash||'').match(/[#&]token=([^&]+)/);return m?decodeURIComponent(m[1]):''}
// Custom tooltip: instant, styled, works with mouse, focus and touch.
(function(){
  const tip=document.createElement('div');tip.className='tooltip';tip.hidden=true;tip.setAttribute('role','tooltip');
  document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(tip));
  if(document.readyState!=='loading')document.body.appendChild(tip);
  let current=null,timer=null;
  const target=(event)=>event.target.closest?event.target.closest('[data-tip]'):null;
  function show(element){
    if(!element||!element.dataset.tip)return;
    current=element;tip.textContent=element.dataset.tip;tip.hidden=false;
    const rect=element.getBoundingClientRect();
    const width=tip.offsetWidth,height=tip.offsetHeight;
    let top=rect.top-height-7;
    if(top<6)top=rect.bottom+7;
    let left=rect.left+rect.width/2-width/2;
    left=Math.max(8,Math.min(left,window.innerWidth-width-8));
    tip.style.top=Math.round(top)+'px';tip.style.left=Math.round(left)+'px';
  }
  function hide(){clearTimeout(timer);current=null;tip.hidden=true}
  document.addEventListener('mouseover',(event)=>{const el=target(event);if(el)show(el)});
  document.addEventListener('mouseout',(event)=>{if(target(event))hide()});
  document.addEventListener('focusin',(event)=>{const el=target(event);if(el)show(el)});
  document.addEventListener('focusout',hide);
  document.addEventListener('pointerdown',(event)=>{const el=target(event);if(el){show(el);timer=setTimeout(hide,2600)}});
  window.addEventListener('scroll',hide,true);
  window.addEventListener('resize',hide);
  document.addEventListener('keydown',(event)=>{if(event.key==='Escape')hide()});
})();
`;
