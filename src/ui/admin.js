// Admin dashboard SPA served at the configured dashboard path.
//
// Hash-routed views: Overview, Keys, Accounts, Plans, Requests, Settings.
// Information density is kept low: only essential columns and fields are
// visible, everything explanatory is a tooltip, and advanced fields live
// behind native <details> disclosure.

import { baseCss, clientCore, escapeHtml, hint } from './theme.js';

export function adminPage({ config }) {
  const title = escapeHtml(config.dashboard.title);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="#000000"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<title>Admin — ${title}</title><style>${baseCss}</style></head>
<body>
<div class="top"><div class="top-inner">
  <a class="brand" href="${escapeHtml(config.dashboard.path)}/"><span class="mark">A</span><span>${title}<small>Admin</small></span></a>
  <nav class="tabs" id="nav">
    <a class="tab" href="#overview" data-tab="overview">Overview</a>
    <a class="tab" href="#keys" data-tab="keys">Keys</a>
    <a class="tab" href="#accounts" data-tab="accounts">Accounts</a>
    <a class="tab" href="#plans" data-tab="plans">Plans</a>
    <a class="tab" href="#requests" data-tab="requests">Requests</a>
    <a class="tab" href="#settings" data-tab="settings">Settings</a>
  </nav>
  <span class="spacer"></span>
  <a class="tab" href="/" data-tip="Public landing page">Landing ↗</a>
  <span class="pill" data-tip="Live event stream from the proxy"><span class="dot" id="connection"></span><span id="connectionLabel">live</span></span>
</div></div>
<main class="wrap" id="view"><div class="empty">Loading…</div></main>
<footer class="foot"><span>${title} · admin</span><span class="muted">${config.keys.requireKey ? 'Keys required' : 'Open mode'} · ${config.billing.markupPct}% markup</span></footer>
<script>
${clientCore}
const BASE=location.pathname.replace(/\\/$/,'');
const TOKEN_KEY='opx_admin_token';
let ADMIN_TOKEN=loadToken(TOKEN_KEY)||new URLSearchParams(location.search).get('token')||'';
if(new URLSearchParams(location.search).get('token')){storeToken(TOKEN_KEY,ADMIN_TOKEN);history.replaceState(null,'',BASE+location.hash)}

async function api(path,options){
  options=options||{};
  options.headers=Object.assign({'x-admin-token':ADMIN_TOKEN,'content-type':'application/json'},options.headers||{});
  const response=await fetch(BASE+'/api'+path,options);
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    if(response.status===401){renderLogin();throw new Error('unauthorized')}
    throw new Error(data.error?.message||('HTTP '+response.status));
  }
  return data;
}

function renderLogin(){
  $('view').innerHTML='<div class="card" style="max-width:400px;margin:52px auto"><div class="hd"><h3>Admin sign in</h3>'+hint('The admin token configured in Settings or via ADMIN_TOKEN')+'</div>'+
    '<div class="bd" style="display:flex;flex-direction:column;gap:11px">'+
    '<input id="adminToken" type="password" class="mono" placeholder="admin token"/>'+
    '<button class="btn primary" id="loginButton">Sign in</button>'+
    '<div id="loginError" class="bad hidden" style="font-size:12px"></div></div></div>';
  $('loginButton').addEventListener('click',async()=>{
    ADMIN_TOKEN=$('adminToken').value.trim();storeToken(TOKEN_KEY,ADMIN_TOKEN);
    try{await api('/overview');route()}catch(error){$('loginError').textContent=error.message;$('loginError').classList.remove('hidden')}
  });
}

function setTab(tab){document.querySelectorAll('#nav .tab[data-tab]').forEach((el)=>el.classList.toggle('active',el.getAttribute('data-tab')===tab))}
function route(){
  const tab=(location.hash||'#overview').slice(1).split('?')[0];
  setTab(tab);
  ({overview:renderOverview,keys:renderKeys,accounts:renderAccounts,plans:renderPlans,requests:renderRequests,settings:renderSettings}[tab]||renderOverview)();
}
window.addEventListener('hashchange',route);

function metric(label,tip,value,sub){return '<div class="card metric"><span class="lbl">'+esc(label)+hint(tip)+'</span><b>'+esc(value)+'</b>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</div>'}
function field(id,label,tip,value,type){return '<label class="f"><span class="lbl">'+esc(label)+(tip?hint(tip):'')+'</span><input id="'+id+'" type="'+type+'" value="'+esc(value)+'"/></label>'}

// ----------------------------------------------------------------- overview
async function renderOverview(){
  $('view').innerHTML='<div class="empty">Loading…</div>';
  try{
    const [overview,recent]=await Promise.all([api('/overview'),api('/requests?limit=8')]);
    const totals=overview.snapshot.totals,revenue=overview.revenue_30d,counts=overview.counts;
    $('view').innerHTML='<div class="page-head"><div><h1>Overview</h1><div class="sub">Traffic, revenue and balances at a glance</div></div>'+
      '<div class="row"><a class="btn sm" href="#requests">Requests</a><a class="btn sm" href="#settings">Settings</a><button class="btn sm" id="refreshOverview">Refresh</button></div></div>'+
      '<div class="grid cols">'+
      metric('Requests','Total proxied requests since start',fmt(totals.requests),fmt(overview.snapshot.active)+' active')+
      metric('Revenue · 30d','Billed customer spend, markup included',usd(revenue.billedUsd),revenue.marginUsd>0?Math.round(revenue.marginUsd/revenue.billedUsd*100)+'% margin':'—')+
      metric('Upstream cost · 30d','What providers charged for keyed traffic',usd(revenue.upstreamUsd),null)+
      metric('Outstanding','Unspent customer balances',usd(overview.outstanding_usd),null)+
      metric('Keys','Active out of total keys',fmt(counts.activeKeys)+' / '+fmt(counts.keys),fmt(counts.subscriptions)+' subscriptions')+
      metric('Accounts','Customer accounts',fmt(counts.accounts),null)+
      '</div>'+
      '<div class="split" style="margin-top:12px">'+
      '<div class="card pad0"><div class="hd"><h3>Top keys · 30d</h3>'+hint('Ranked by billed spend')+'</div><div class="tablewrap"><table><thead><tr><th>Key</th><th class="num">Spend</th><th class="num">Requests</th><th class="num">Tokens</th></tr></thead><tbody>'+
      ((overview.top_keys||[]).map((key)=>'<tr><td class="mono">'+esc(key.keyPrefix)+'…</td><td class="num">'+usd(key.billedUsd)+'</td><td class="num">'+fmt(key.requests)+'</td><td class="num">'+compact(key.tokens)+'</td></tr>').join('')||'<tr><td colspan="4"><div class="empty">No keyed traffic yet</div></td></tr>')+
      '</tbody></table></div></div>'+
      '<div class="card pad0"><div class="hd"><h3>Recent requests</h3><a class="muted" href="#requests" style="font-size:12px">View all</a></div><div class="tablewrap"><table><thead><tr><th>Time</th><th>Type</th><th>Status</th><th class="num">Cost</th></tr></thead><tbody>'+
      ((recent.requests||[]).map((request)=>'<tr><td class="muted">'+esc(timeFmt(request.time))+'</td><td>'+kindBadge(request.kind)+'</td><td>'+statusBadge(request.status)+'</td><td class="num">'+usd(request.billedCostUsd)+'</td></tr>').join('')||'<tr><td colspan="4"><div class="empty">No traffic yet</div></td></tr>')+
      '</tbody></table></div></div></div>';
    $('refreshOverview').addEventListener('click',renderOverview);
  }catch(error){if(error.message!=='unauthorized')$('view').innerHTML='<div class="empty">'+esc(error.message)+'</div>'}
}

// --------------------------------------------------------------------- keys
const keysState={q:'',status:'',offset:0,limit:50};
async function renderKeys(){
  $('view').innerHTML='<div class="page-head"><div><h1>Keys</h1><div class="sub">Customer keys, limits and status</div></div><span class="muted" id="keyTotal" style="font-size:11.5px"></span></div>'+
    '<div class="card pad0"><div class="toolbar">'+
    '<input id="keySearch" placeholder="Search label, prefix, account…" value="'+esc(keysState.q)+'"/>'+
    '<select class="select" id="keyStatus" style="width:140px" data-tip="Filter by key status"><option value="">All statuses</option><option value="active">Active</option><option value="blocked">Blocked</option><option value="revoked">Revoked</option></select>'+
    '<button class="btn sm" id="keyRefresh">Refresh</button></div>'+
    '<div class="tablewrap"><table><thead><tr><th>Key</th><th>Status</th><th class="num">30d spend'+hint('Billed customer amount over the last 30 days')+'</th><th></th></tr></thead><tbody id="keysBody"><tr><td colspan="4"><div class="empty">Loading…</div></td></tr></tbody></table></div>'+
    '<div class="pager"><button class="btn sm" id="keysPrev">‹ Prev</button><span class="muted" id="keysPage"></span><button class="btn sm" id="keysNext">Next ›</button></div></div>';
  $('keyStatus').value=keysState.status;
  $('keySearch').addEventListener('input',()=>{clearTimeout(window._keyTimer);window._keyTimer=setTimeout(()=>{keysState.q=$('keySearch').value.trim();keysState.offset=0;loadKeys()},250)});
  $('keyStatus').addEventListener('change',()=>{keysState.status=$('keyStatus').value;keysState.offset=0;loadKeys()});
  $('keyRefresh').addEventListener('click',loadKeys);
  $('keysPrev').addEventListener('click',()=>{keysState.offset=Math.max(0,keysState.offset-keysState.limit);loadKeys()});
  $('keysNext').addEventListener('click',()=>{keysState.offset+=keysState.limit;loadKeys()});
  loadKeys();
}
async function loadKeys(){
  try{
    const data=await api('/keys?q='+encodeURIComponent(keysState.q)+'&status='+encodeURIComponent(keysState.status)+'&limit='+keysState.limit+'&offset='+keysState.offset);
    $('keyTotal').textContent=fmt(data.total)+' keys';
    $('keysPage').textContent='Showing '+(data.total?keysState.offset+1:0)+'–'+Math.min(keysState.offset+keysState.limit,data.total)+' of '+fmt(data.total);
    $('keysPrev').disabled=keysState.offset<=0;
    $('keysNext').disabled=keysState.offset+keysState.limit>=data.total;
    $('keysBody').innerHTML=data.keys.map((key)=>{
      const meta='Created '+dateFmt(key.created_at)+(key.last_used_at?' · last used '+timeAgo(key.last_used_at):'')+' · account '+key.account_id+(key.account_contact?' ('+key.account_contact+')':'');
      const limits=key.limits||{};
      const limitBits=[];
      if(limits.spend)limitBits.push(usd(limits.spend.max_usd)+'/'+limits.spend.window_hours+'h');
      if(limits.rpm)limitBits.push(limits.rpm+' rpm');
      if(limits.requests)limitBits.push(limits.requests.max+' req');
      const sub=[key.name||key.account_id].concat(limitBits.length?[limitBits.join(' · ')]:[]).join(' · ');
      return '<tr>'+
        '<td><div class="stack"><span class="mono">'+esc(key.key_prefix)+'…</span><small class="trunc" data-tip="'+esc(meta)+'">'+esc(sub)+'</small></div></td>'+
        '<td>'+keyStatusBadge(key.status)+'</td>'+
        '<td class="num">'+usd(key.usage_30d?.billed_cost_usd||0)+'</td>'+
        '<td class="num"><button class="btn sm" data-key="'+esc(key.id)+'">Manage</button></td></tr>';
    }).join('')||'<tr><td colspan="4"><div class="empty">No keys match</div></td></tr>';
    $('keysBody').querySelectorAll('[data-key]').forEach((button)=>button.addEventListener('click',()=>openKey(button.getAttribute('data-key'))));
  }catch(error){if(error.message!=='unauthorized')toast(error.message,'bad')}
}
async function openKey(id){
  try{
    const data=await api('/keys/'+encodeURIComponent(id));
    const key=data.key,limits=key.limits||{};
    const advancedCount=[limits.tokens,limits.requests,limits.allowed_models&&limits.allowed_models.length,key.expires_at].filter(Boolean).length;
    const modal=openModal({
      title:'Key '+key.key_prefix+'…',
      subtitle:'Account '+key.account_id+' · '+fmt(key.total_requests)+' requests · '+usd(key.usage_30d?.billed_cost_usd||0)+' in 30d',
      wide:true,
      body:'<div class="formgrid">'+
        field('keyName','Label','Optional name for this key',key.name||'','text')+
        '<label class="f"><span class="lbl">Status'+hint('Blocked keys reject requests but keep dashboard access')+'</span><select id="keyStatusField" class="select"><option value="active">active</option><option value="blocked">blocked</option><option value="revoked">revoked</option></select></label>'+
        field('keyMarkup','Markup %','Overrides the account and global markup. Empty uses them.',key.markup_pct==null?'':key.markup_pct,'number')+
        field('keySpend','Spend limit USD','Maximum billed amount in the window below',limits.spend?limits.spend.max_usd:'','number')+
        field('keySpendWindow','Spend window h','Rolling window for the spend limit',limits.spend?limits.spend.window_hours:720,'number')+
        field('keyRpm','Requests / minute','Rate limit burst protection',limits.rpm||'','number')+
        '</div>'+
        '<details class="more"><summary>Advanced limits'+(advancedCount?'<span class="count">'+advancedCount+' set</span>':'')+'</summary><div class="body"><div class="formgrid" style="padding:0">'+
        field('keyTokens','Token limit','Input + output tokens in the window',limits.tokens?limits.tokens.max:'','number')+
        field('keyTokensWindow','Token window h','Rolling window for the token limit',limits.tokens?limits.tokens.window_hours:720,'number')+
        field('keyRequests','Request limit','Request count in the window',limits.requests?limits.requests.max:'','number')+
        field('keyRequestsWindow','Request window h','Rolling window for the request limit',limits.requests?limits.requests.window_hours:24,'number')+
        field('keyModels','Allowed models','Comma-separated allowlist. Empty allows all models.',(limits.allowed_models||[]).join(', '),'text')+
        field('keyExpires','Expires at','ISO date after which the key is rejected',key.expires_at||'','text')+
        '</div></div></details>'+
        '<p class="m-note">Changes apply immediately. Rotating blocks this key and creates a replacement with the same limits.</p>',
      actions:'<button class="btn danger" id="keyRevoke">Revoke</button><button class="btn" id="keyRotate">Rotate</button><button class="btn primary" id="keySave">Save</button>'
    });
    modal.querySelector('#keyStatusField').value=key.status;
    modal.querySelector('#keySave').addEventListener('click',async()=>{
      try{
        const value=(id)=>modal.querySelector('#'+id).value.trim();
        const limits={};
        if(value('keySpend'))limits.spend={max_usd:Number(value('keySpend')),window_hours:Number(value('keySpendWindow')||720)};
        if(value('keyRequests'))limits.requests={max:Number(value('keyRequests')),window_hours:Number(value('keyRequestsWindow')||24)};
        if(value('keyTokens'))limits.tokens={max:Number(value('keyTokens')),window_hours:Number(value('keyTokensWindow')||720)};
        if(value('keyRpm'))limits.rpm=Number(value('keyRpm'));
        const models=value('keyModels').split(',').map((model)=>model.trim()).filter(Boolean);
        if(models.length)limits.allowed_models=models;
        await api('/keys/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({
          name:value('keyName'),
          status:modal.querySelector('#keyStatusField').value,
          markup_pct:value('keyMarkup')===''?null:Number(value('keyMarkup')),
          limits,
          expires_at:value('keyExpires')||null
        })});
        toast('Key updated','ok');modal.remove();loadKeys();
      }catch(error){toast(error.message,'bad')}
    });
    modal.querySelector('#keyRotate').addEventListener('click',async()=>{
      const confirmed=await confirmModal({
        title:'Replace this key?',
        subtitle:'Blocks it and creates a replacement',
        body:'<div class="m-section">'+
          '<div class="m-kv"><span class="k">Current key</span><span class="v">blocked immediately</span></div>'+
          '<div class="m-kv"><span class="k">Replacement</span><span class="v">same account, limits and markup</span></div>'+
          '<div class="m-kv"><span class="k">Dashboard</span><span class="v">old token stays valid</span></div></div>',
        confirmLabel:'Replace key'
      });
      if(!confirmed)return;
      try{const result=await api('/keys/'+encodeURIComponent(id)+'/rotate',{method:'POST'});modal.remove();showKeyReveal(result,'Replacement created. Update the customer with the new key.');loadKeys()}catch(error){toast(error.message,'bad')}
    });
    modal.querySelector('#keyRevoke').addEventListener('click',async()=>{
      const confirmed=await confirmModal({
        title:'Revoke this key?',
        subtitle:'This cannot be undone',
        body:'<p class="m-note">The key stops working immediately and its dashboard token is revoked. Use <b>blocked</b> instead if the customer only needs a temporary stop.</p>',
        confirmLabel:'Revoke permanently',
        danger:true
      });
      if(!confirmed)return;
      try{await api('/keys/'+encodeURIComponent(id)+'/revoke',{method:'POST'});toast('Key revoked','ok');modal.remove();loadKeys()}catch(error){toast(error.message,'bad')}
    });
  }catch(error){toast(error.message,'bad')}
}
function showKeyReveal(data,note){
  const modal=openModal({
    title:'New API key',
    subtitle:'Shown only once — store it now',
    body:'<div class="secret"><code class="mono" id="revealKey">'+esc(data.key)+'</code><button class="btn sm" id="copyRevealKey">Copy</button></div>'+
      (data.dashboard_url?'<div class="secret"><code class="mono" id="revealDashboard">'+esc(data.dashboard_url)+'</code><button class="btn sm" id="copyRevealDashboard">Copy</button></div>':'')+
      (note?'<p class="m-note">'+esc(note)+'</p>':''),
    actions:'<button class="btn primary" id="revealDone">Done</button>'
  });
  modal.querySelector('#copyRevealKey').addEventListener('click',()=>copy(data.key,'API key'));
  if(data.dashboard_url)modal.querySelector('#copyRevealDashboard').addEventListener('click',()=>copy(data.dashboard_url,'Dashboard link'));
  modal.querySelector('#revealDone').addEventListener('click',()=>modal.remove());
}

// ----------------------------------------------------------------- accounts
const accountsState={q:'',status:'',offset:0,limit:50};
async function renderAccounts(){
  $('view').innerHTML='<div class="page-head"><div><h1>Accounts</h1><div class="sub">Balances, plans and permissions</div></div><span class="muted" id="accountTotal" style="font-size:11.5px"></span></div>'+
    '<div class="card pad0"><div class="toolbar"><input id="accountSearch" placeholder="Search account, contact, note…" value="'+esc(accountsState.q)+'"/>'+
    '<select class="select" id="accountStatus" style="width:140px" data-tip="Filter by status"><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select>'+
    '<button class="btn sm" id="accountRefresh">Refresh</button></div>'+
    '<div class="tablewrap"><table><thead><tr><th>Account</th><th>Status</th><th class="num">Balance'+hint('Unexpired customer credit')+'</th><th class="num">Keys'+hint('Active keys on the account')+'</th><th>Plan</th><th></th></tr></thead><tbody id="accountBody"><tr><td colspan="6"><div class="empty">Loading…</div></td></tr></tbody></table></div>'+
    '<div class="pager"><button class="btn sm" id="accountsPrev">‹ Prev</button><span class="muted" id="accountsPage"></span><button class="btn sm" id="accountsNext">Next ›</button></div></div>';
  $('accountStatus').value=accountsState.status;
  $('accountSearch').addEventListener('input',()=>{clearTimeout(window._accountTimer);window._accountTimer=setTimeout(()=>{accountsState.q=$('accountSearch').value.trim();accountsState.offset=0;loadAccounts()},250)});
  $('accountStatus').addEventListener('change',()=>{accountsState.status=$('accountStatus').value;accountsState.offset=0;loadAccounts()});
  $('accountRefresh').addEventListener('click',loadAccounts);
  $('accountsPrev').addEventListener('click',()=>{accountsState.offset=Math.max(0,accountsState.offset-accountsState.limit);loadAccounts()});
  $('accountsNext').addEventListener('click',()=>{accountsState.offset+=accountsState.limit;loadAccounts()});
  loadAccounts();
}
async function loadAccounts(){
  try{
    const data=await api('/accounts?q='+encodeURIComponent(accountsState.q)+'&status='+encodeURIComponent(accountsState.status)+'&limit='+accountsState.limit+'&offset='+accountsState.offset);
    $('accountTotal').textContent=fmt(data.total)+' accounts';
    $('accountsPage').textContent='Showing '+(data.total?accountsState.offset+1:0)+'–'+Math.min(accountsState.offset+accountsState.limit,data.total)+' of '+fmt(data.total);
    $('accountsPrev').disabled=accountsState.offset<=0;
    $('accountsNext').disabled=accountsState.offset+accountsState.limit>=data.total;
    $('accountBody').innerHTML=data.accounts.map((account)=>'<tr>'+
      '<td><div class="stack"><span class="mono">'+esc(account.id)+'</span>'+(account.contact?'<small>'+esc(account.contact)+'</small>':'')+'</div></td>'+
      '<td>'+keyStatusBadge(account.status)+'</td>'+
      '<td class="num">'+usd(account.balance_usd)+'</td><td class="num">'+fmt(account.active_keys||0)+'</td>'+
      '<td>'+(account.subscription?'<span class="badge" data-tip="Expires '+esc(dateFmt(account.subscription.expires_at))+'">'+esc(account.subscription.plan_code)+'</span>':'<span class="muted">—</span>')+'</td>'+
      '<td class="num"><button class="btn sm" data-account="'+esc(account.id)+'">Manage</button></td></tr>').join('')||
      '<tr><td colspan="6"><div class="empty">No accounts match</div></td></tr>';
    $('accountBody').querySelectorAll('[data-account]').forEach((button)=>button.addEventListener('click',()=>openAccount(button.getAttribute('data-account'))));
  }catch(error){if(error.message!=='unauthorized')toast(error.message,'bad')}
}
async function openAccount(id){
  try{
    const [data,plans]=await Promise.all([api('/accounts/'+encodeURIComponent(id)),api('/plans')]);
    const account=data.account;
    const modal=openModal({
      title:'Account',
      subtitle:account.id,
      wide:true,
      body:'<div class="stat-inline">'+
      '<div class="tile"><div class="k">Balance</div><div class="v">'+usd(account.balance_usd)+'</div></div>'+
      '<div class="tile"><div class="k">Free</div><div class="v">'+usd(account.free_credit_usd)+'</div></div>'+
      '<div class="tile"><div class="k">Subscription</div><div class="v">'+usd(account.subscription_credit_usd)+'</div></div>'+
      '<div class="tile"><div class="k">Purchased</div><div class="v">'+usd(account.purchased_credit_usd)+'</div></div>'+
      '</div>'+
      '<div class="formgrid">'+
      '<label class="f"><span class="lbl">Status'+hint('Suspended accounts reject every request')+'</span><select id="accountStatusField" class="select"><option value="active">active</option><option value="suspended">suspended</option></select></label>'+
      field('accountContact','Contact','Optional email or handle',account.contact||'','text')+
      field('accountNote','Note','Internal reminder',account.note||'','text')+
      field('accountMarkup','Markup %','Overrides the global markup. Empty uses it.',account.markup_pct==null?'':account.markup_pct,'number')+
      '<label class="f"><span class="lbl">Keys without subscription'+hint('Allow this account to create keys without an active subscription')+'</span><select id="accountCreate" class="select"><option value="0">no</option><option value="1">yes</option></select></label>'+
      '</div>'+
      '<div class="m-section"><div class="sec-title">Manage account</div>'+
      '<details class="more"><summary>Add credit</summary><div class="body"><div class="formgrid" style="padding:0">'+
      field('creditAmount','Amount USD','', '', 'number')+
      field('creditNote','Note','', '', 'text')+
      '<label class="f"><span class="lbl">Source</span><select id="creditSource" class="select"><option value="admin">admin</option><option value="purchase">purchase</option><option value="refund">refund</option></select></label>'+
      field('creditExpiry','Expires at','Optional ISO date', '', 'text')+
      '<div style="display:flex;align-items:flex-end"><button class="btn" id="creditAdd" style="width:100%">Add credit</button></div>'+
      '</div></div></details>'+
      '<details class="more"><summary>Grant a subscription</summary><div class="body"><div class="formgrid" style="padding:0">'+
      '<label class="f"><span class="lbl">Plan'+hint('Grants the plan credit with its expiry and exempts the account from per-IP key limits')+'</span><select id="planSelect" class="select">'+plans.plans.map((plan)=>'<option value="'+esc(plan.code)+'">'+esc(plan.name)+' · $'+plan.price_usd+'</option>').join('')+'</select></label>'+
      '<div style="display:flex;align-items:flex-end"><button class="btn" id="planGrant" style="width:100%">Grant</button></div>'+
      '</div></div></details>'+
      '<details class="more"><summary>Keys · '+data.keys.length+'</summary><div class="body">'+
      '<button class="btn sm" id="accountNewKey" style="align-self:flex-start">Create key</button>'+
      '<div class="tablewrap" style="max-height:200px"><table><thead><tr><th>Key</th><th>Status</th><th class="num">30d</th></tr></thead><tbody>'+
      data.keys.map((key)=>'<tr><td class="mono" data-tip="Created '+esc(dateFmt(key.created_at))+'">'+esc(key.key_prefix)+'…</td><td>'+keyStatusBadge(key.status)+'</td><td class="num">'+usd(key.total_billed_usd||0)+'</td></tr>').join('')+
      '</tbody></table></div></div></details>'+
      '<details class="more"><summary>Credit history · '+data.credits.length+'</summary><div class="body">'+
      (data.credits.length
        ?'<div class="credit-list">'+data.credits.map((credit)=>{
          const total=Number(credit.amountUsd)||0;
          const remaining=Number(credit.remainingUsd)||0;
          const pct=total>0?Math.max(0,Math.min(100,Math.round(remaining/total*100))):0;
          const days=credit.expiresAt?Math.max(0,Math.ceil((Date.parse(credit.expiresAt)-Date.now())/86400000)):null;
          const expiry=credit.expiresAt?(days===0?'expires today':days+' day'+(days===1?'':'s')+' left'):'never expires';
          return '<div class="credit">'+
            '<div class="top"><span class="badge">'+esc(credit.source)+'</span><span class="amt">'+usd(remaining)+'</span></div>'+
            '<span class="bar"><i style="width:'+pct+'%"></i></span>'+
            '<div class="sub"><span>'+usd(total)+' granted</span><span data-tip="Expires '+esc(dateFmt(credit.expiresAt))+'">'+esc(expiry)+'</span></div>'+
            '</div>';
        }).join('')+'</div>'
        :'<div class="empty" style="padding:8px 0">No credit yet</div>')+
      '</div></details></div>',
      actions:'<button class="btn danger" id="accountSuspend">Suspend</button><button class="btn primary" id="accountSave">Save</button>'
    });
    modal.querySelector('#accountStatusField').value=account.status;
    modal.querySelector('#accountCreate').value=account.can_create_keys?'1':'0';
    modal.querySelector('#accountSuspend').textContent=account.status==='active'?'Suspend':'Reactivate';
    modal.querySelector('#accountSave').addEventListener('click',async()=>{
      try{
        await api('/accounts/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({
          contact:modal.querySelector('#accountContact').value,
          note:modal.querySelector('#accountNote').value,
          status:modal.querySelector('#accountStatusField').value,
          markup_pct:modal.querySelector('#accountMarkup').value===''?null:Number(modal.querySelector('#accountMarkup').value),
          can_create_keys:modal.querySelector('#accountCreate').value==='1'
        })});
        toast('Account updated','ok');modal.remove();loadAccounts();
      }catch(error){toast(error.message,'bad')}
    });
    modal.querySelector('#accountSuspend').addEventListener('click',async()=>{
      const suspending=modal.querySelector('#accountStatusField').value==='active';
      const confirmed=await confirmModal({
        title:suspending?'Suspend this account?':'Reactivate this account?',
        subtitle:suspending?'All of its keys stop working immediately':'Keys become usable again immediately',
        body:suspending
          ?'<p class="m-note">Keys and balances are kept, so nothing is lost. Suspended accounts are rejected with <span class="mono">account_suspended</span> until reactivated.</p>'
          :'<p class="m-note">The account returns to normal operation right away.</p>',
        confirmLabel:suspending?'Suspend account':'Reactivate',
        danger:suspending
      });
      if(!confirmed)return;
      const status=suspending?'suspended':'active';
      try{
        await api('/accounts/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status})});
        toast(status==='suspended'?'Account suspended':'Account reactivated','ok');modal.remove();loadAccounts();
      }catch(error){toast(error.message,'bad')}
    });
    modal.querySelector('#creditAdd').addEventListener('click',async()=>{
      try{
        await api('/accounts/'+encodeURIComponent(id)+'/credits',{method:'POST',body:JSON.stringify({
          amount_usd:Number(modal.querySelector('#creditAmount').value),
          note:modal.querySelector('#creditNote').value,
          source:modal.querySelector('#creditSource').value,
          expires_at:modal.querySelector('#creditExpiry').value.trim()||null
        })});
        toast('Credit added','ok');modal.remove();openAccount(id);
      }catch(error){toast(error.message,'bad')}
    });
    modal.querySelector('#planGrant').addEventListener('click',async()=>{
      try{
        await api('/accounts/'+encodeURIComponent(id)+'/subscriptions',{method:'POST',body:JSON.stringify({plan_code:modal.querySelector('#planSelect').value})});
        toast('Subscription granted','ok');modal.remove();openAccount(id);
      }catch(error){toast(error.message,'bad')}
    });
    modal.querySelector('#accountNewKey').addEventListener('click',async()=>{
      try{
        const result=await api('/accounts/'+encodeURIComponent(id)+'/keys',{method:'POST',body:JSON.stringify({name:'admin'})});
        modal.remove();showKeyReveal(result,'Created by an administrator.');loadAccounts();
      }catch(error){toast(error.message,'bad')}
    });
  }catch(error){toast(error.message,'bad')}
}

// ------------------------------------------------------------- plans & codes
async function renderPlans(){
  try{
    const [planData,codeData]=await Promise.all([api('/plans'),api('/codes')]);
    $('view').innerHTML='<div class="page-head"><div><h1>Plans</h1><div class="sub">Subscription products and prepaid codes</div></div><button class="btn sm" id="planNew">New plan</button></div>'+
      '<div class="grid cols2">'+planData.plans.map((plan)=>'<div class="card"><div class="bd">'+
      '<div class="row" style="justify-content:space-between"><h3>'+esc(plan.name)+'</h3><span class="badge '+(plan.active?'ok':'')+'">'+(plan.active?'active':'disabled')+'</span></div>'+
      '<div style="font-size:20px;font-weight:700;margin:8px 0 2px">$'+plan.priceUsd+'<span class="muted" style="font-size:12px;font-weight:450"> / '+plan.durationDays+' days</span></div>'+
      '<div class="row" style="justify-content:space-between;margin-top:6px"><span class="muted" style="font-size:12px">'+usd(plan.creditUsd)+' credit</span>'+
      '<span class="row" style="gap:6px"><button class="btn sm" data-edit-plan="'+esc(plan.code)+'">Edit</button>'+
      '<button class="btn sm" data-code-plan="'+esc(plan.code)+'" data-tip="Generate a single-use code for this plan">Code</button></span></div>'+
      '</div></div>').join('')+'</div>'+
      '<div class="card pad0" style="margin-top:12px"><div class="hd"><h3>Redeem codes</h3>'+
      '<div class="row"><input id="codeAmount" type="number" placeholder="credit USD" style="width:120px" data-tip="Generate a credit-only code"/><button class="btn sm" id="codeCreate">Generate</button></div></div>'+
      '<div class="tablewrap" style="max-height:340px"><table><thead><tr><th>Code</th><th>Value</th><th>Status</th><th class="opt">Note</th><th class="opt">Created</th></tr></thead><tbody id="codesBody"></tbody></table></div></div>'+
      '<div id="planForm"></div>';
    $('codesBody').innerHTML=codeData.codes.map((code)=>'<tr><td class="mono">'+esc(code.code)+'</td>'+
      '<td>'+(code.planCode?esc(code.planCode):usd(code.creditUsd||0))+'</td>'+
      '<td>'+(code.redeemedAt?'<span class="badge" data-tip="Redeemed '+esc(dateFmt(code.redeemedAt))+'">used</span>':'<span class="badge ok">unused</span>')+'</td>'+
      '<td class="muted opt">'+esc(code.note||'')+'</td><td class="muted opt">'+esc(dateFmt(code.createdAt))+'</td></tr>').join('')||
      '<tr><td colspan="5"><div class="empty">No codes yet</div></td></tr>';

    const showPlanForm=(plan)=>{
      $('planForm').innerHTML='<div class="card" style="margin-top:12px"><div class="hd"><h3>'+(plan?'Edit plan':'New plan')+'</h3><button class="btn sm ghost" id="planCancel">✕</button></div>'+
        '<div class="formgrid">'+
        field('planCode','Code','Lowercase identifier, immutable once created',plan?plan.code:'','text')+
        field('planName','Name','Shown to customers',plan?plan.name:'','text')+
        field('planPrice','Price USD','What the customer pays',plan?plan.priceUsd:'','number')+
        field('planCredit','Credit USD','Balance added on grant',plan?plan.creditUsd:'','number')+
        field('planDays','Duration days','Credit expiry and subscription period',plan?plan.durationDays:'','number')+
        field('planSort','Sort order','Display order, lower first',plan?plan.sort:'','number')+
        field('planDescription','Description','Optional customer-facing text',plan?plan.description:'','text')+
        '<label class="f"><span class="lbl">Active</span><select id="planActive" class="select"><option value="1">yes</option><option value="0">no</option></select></label>'+
        '</div><div class="row" style="justify-content:flex-end;padding:0 12px 12px"><button class="btn primary" id="planSave">Save plan</button></div></div>';
      if(plan)$('planActive').value=plan.active?'1':'0';
      $('planCancel').addEventListener('click',()=>{$('planForm').innerHTML=''});
      $('planSave').addEventListener('click',async()=>{
        try{
          await api('/plans',{method:'POST',body:JSON.stringify({
            code:$('planCode').value,name:$('planName').value,price_usd:Number($('planPrice').value),
            credit_usd:Number($('planCredit').value),duration_days:Number($('planDays').value),
            sort:Number($('planSort').value||0),description:$('planDescription').value,active:$('planActive').value==='1'
          })});
          toast('Plan saved','ok');renderPlans();
        }catch(error){toast(error.message,'bad')}
      });
      $('planForm').scrollIntoView({behavior:'smooth',block:'nearest'});
    };
    $('planNew').addEventListener('click',()=>showPlanForm(null));
    $('view').querySelectorAll('[data-edit-plan]').forEach((button)=>button.addEventListener('click',()=>{
      const plan=planData.plans.find((entry)=>entry.code===button.getAttribute('data-edit-plan'));
      if(plan)showPlanForm(plan);
    }));
    $('view').querySelectorAll('[data-code-plan]').forEach((button)=>button.addEventListener('click',async()=>{
      try{const result=await api('/codes',{method:'POST',body:JSON.stringify({plan_code:button.getAttribute('data-code-plan')})});toast('Code '+result.code.code+' created','ok');renderPlans()}
      catch(error){toast(error.message,'bad')}
    }));
    $('codeCreate').addEventListener('click',async()=>{
      const amount=Number($('codeAmount').value);
      if(!amount){toast('Enter a credit amount','bad');return}
      try{const result=await api('/codes',{method:'POST',body:JSON.stringify({credit_usd:amount})});toast('Code '+result.code.code+' created','ok');renderPlans()}
      catch(error){toast(error.message,'bad')}
    });
  }catch(error){if(error.message!=='unauthorized')$('view').innerHTML='<div class="empty">'+esc(error.message)+'</div>'}
}

// ----------------------------------------------------------------- requests
const requestsState={page:1,limit:50,total:0,q:'',kind:'',group:''};
async function renderRequests(){
  $('view').innerHTML='<div class="page-head"><div><h1>Requests</h1><div class="sub">Every proxied call, newest first</div></div><span class="muted" id="requestTotal" style="font-size:11.5px"></span></div>'+
    '<div class="card pad0"><div class="toolbar">'+
    '<input id="requestSearch" placeholder="Search path, model, IP, key…" value="'+esc(requestsState.q)+'"/>'+
    '<select class="select" id="requestKind" style="width:120px" data-tip="Filter by route type"><option value="">All types</option><option value="llm">LLM</option><option value="tts">TTS</option><option value="stt">STT</option></select>'+
    '<select class="select" id="requestGroup" style="width:150px" data-tip="Aggregate matching requests by a field"><option value="">Group by…</option><option value="model">Model</option><option value="ip">IP</option><option value="status">Status</option><option value="kind">Type</option><option value="path">Path</option><option value="key">Key</option><option value="hour">Hour</option></select>'+
    '<button class="btn sm" id="requestRefresh">Refresh</button></div>'+
    '<div id="groupsBox"></div>'+
    '<div class="tablewrap" style="max-height:64vh"><table><thead><tr><th>Time</th><th>Type</th><th>Request</th><th>Status</th><th class="num">Tokens'+hint('Input + output tokens reported by the provider')+'</th><th class="num">Cost'+hint('Billed amount incl. markup')+'</th><th class="opt">Key</th></tr></thead><tbody id="requestBody"><tr><td colspan="7"><div class="empty">Loading…</div></td></tr></tbody></table></div>'+
    '<div class="pager"><button class="btn sm" id="requestsPrev">‹ Prev</button><span class="muted" id="requestsPage"></span><button class="btn sm" id="requestsNext">Next ›</button></div></div>';
  $('requestKind').value=requestsState.kind;$('requestGroup').value=requestsState.group;
  $('requestSearch').addEventListener('input',()=>{clearTimeout(window._requestTimer);window._requestTimer=setTimeout(()=>{requestsState.q=$('requestSearch').value.trim();requestsState.page=1;loadRequests()},300)});
  $('requestKind').addEventListener('change',()=>{requestsState.kind=$('requestKind').value;requestsState.page=1;loadRequests()});
  $('requestGroup').addEventListener('change',()=>{requestsState.group=$('requestGroup').value;loadRequests()});
  $('requestRefresh').addEventListener('click',loadRequests);
  $('requestsPrev').addEventListener('click',()=>{requestsState.page=Math.max(1,requestsState.page-1);loadRequests()});
  $('requestsNext').addEventListener('click',()=>{requestsState.page+=1;loadRequests()});
  loadRequests();
}
async function loadRequests(){
  try{
    const params=new URLSearchParams({limit:String(requestsState.limit),offset:String((requestsState.page-1)*requestsState.limit)});
    if(requestsState.q)params.set('q',requestsState.q);
    if(requestsState.kind)params.set('kind',requestsState.kind);
    const data=await api('/requests?'+params.toString());
    requestsState.total=data.total||0;
    $('requestTotal').textContent=fmt(requestsState.total)+' requests';
    const pages=Math.max(1,Math.ceil(requestsState.total/requestsState.limit));
    if(requestsState.page>pages)requestsState.page=pages;
    $('requestsPage').textContent='Page '+requestsState.page+' of '+pages;
    $('requestsPrev').disabled=requestsState.page<=1;
    $('requestsNext').disabled=requestsState.page>=pages;
    $('requestBody').innerHTML=(data.requests||[]).map((request)=>{
      const meta=(request.method||'')+' '+(request.path||'')+(request.clientIp?' · '+request.clientIp:'')+' · '+dur(request.durationMs)+(request.error?' · '+request.error:'');
      return '<tr>'+
        '<td class="muted" data-tip="'+esc(request.time)+'">'+esc(timeFmt(request.time))+'</td>'+
        '<td>'+kindBadge(request.kind)+'</td>'+
        '<td><div class="stack"><span class="mono trunc" data-tip="'+esc(meta)+'">'+esc(request.path||'')+'</span><small class="trunc">'+esc(request.model||'—')+'</small></div></td>'+
        '<td>'+statusBadge(request.status)+'</td><td class="num">'+fmt(request.usage?.totalTokens||0)+'</td>'+
        '<td class="num">'+usd(request.billedCostUsd||0)+'</td>'+
        '<td class="mono opt">'+esc(request.keyPrefix?request.keyPrefix+'…':'—')+'</td></tr>';
    }).join('')||
      '<tr><td colspan="7"><div class="empty">No requests match</div></td></tr>';
    if(requestsState.group){
      const query=new URLSearchParams({field:requestsState.group,limit:'14'});
      if(requestsState.q)query.set('q',requestsState.q);
      if(requestsState.kind)query.set('kind',requestsState.kind);
      const group=await api('/requests/groups?'+query.toString());
      $('groupsBox').innerHTML='<div style="padding:10px 14px;border-bottom:1px solid var(--border)">'+
        '<div class="lbl muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px">Top '+esc(group.field)+'</div>'+
        '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:6px">'+
        group.groups.map((entry)=>'<div class="row" style="justify-content:space-between;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:6px 9px;font-size:12px">'+
          '<span class="mono trunc" data-tip="'+esc(entry.label||entry.key)+'">'+esc(entry.label||entry.key)+'</span><span class="muted">'+fmt(entry.count)+' · '+usd(entry.billedCostUsd||0)+'</span></div>').join('')+
        '</div></div>';
    }else $('groupsBox').innerHTML='';
  }catch(error){if(error.message!=='unauthorized')toast(error.message,'bad')}
}

// ----------------------------------------------------------------- settings
async function renderSettings(){
  try{
    const data=await api('/settings');
    const groups={};
    for(const setting of data.settings)(groups[setting.group]||(groups[setting.group]=[])).push(setting);
    const order=['upstreams','billing','keys','server','dashboard'];
    const settingRow=(setting)=>{
      const id='setting_'+setting.key.replace(/[^a-z0-9]/gi,'_');
      const tip=(setting.description||'')+(setting.secret&&setting.hasValue?' (configured)':'');
      let input;
      if(setting.type==='bool')input='<select class="select" id="'+id+'" data-key="'+esc(setting.key)+'"><option value="true">enabled</option><option value="false">disabled</option></select>';
      else if(setting.type==='enum')input='<select class="select" id="'+id+'" data-key="'+esc(setting.key)+'">'+setting.options.map((option)=>'<option value="'+esc(option)+'">'+esc(option)+'</option>').join('')+'</select>';
      else if(setting.type==='json'||setting.type==='list')input='<textarea id="'+id+'" data-key="'+esc(setting.key)+'" rows="2" class="mono" style="font-size:12px">'+esc(JSON.stringify(setting.value))+'</textarea>';
      else input='<input id="'+id+'" data-key="'+esc(setting.key)+'" type="'+(setting.secret?'password':setting.type==='int'||setting.type==='float'?'number':'text')+'" '+(setting.secret&&setting.hasValue?'placeholder="configured — leave blank to keep"':'value="'+esc(setting.value??'')+'"')+'/>';
      return '<div class="setting" data-search="'+esc((setting.label+' '+setting.key).toLowerCase())+'">'+
        '<div class="name">'+esc(setting.label)+(tip?hint(tip):'')+'</div>'+
        '<div class="control">'+input+'</div></div>';
    };
    const GROUP_HINTS={
      upstreams:'Provider endpoints, keys, models and fallbacks',
      billing:'Markup, evaluation credit and the price table',
      keys:'Key issuing, abuse limits and key formats',
      server:'HTTP behavior, logging and proxy trust',
      dashboard:'Admin path, branding and access token'
    };
    $('view').innerHTML='<div class="page-head"><div><h1>Settings</h1><div class="sub">Runtime configuration — applied immediately</div></div><div class="row"><input id="settingsFilter" placeholder="Filter settings…" style="width:210px"/>'+
      '<button class="btn primary" id="settingsSave">Save changes</button></div></div>'+
      '<div id="settingsGroups">'+Object.entries(groups).sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0])).map(([group,items])=>
        '<details class="settings-group"'+(group==='billing'||group==='keys'?' open':'')+' data-group="'+esc(group)+'">'+
        '<summary>'+esc(group)+hint(GROUP_HINTS[group]||'')+'<span class="count">'+items.length+'</span></summary>'+
        '<div class="settings-body">'+items.map(settingRow).join('')+'</div></details>').join('')+'</div>';
    for(const setting of data.settings){
      const element=$('setting_'+setting.key.replace(/[^a-z0-9]/gi,'_'));
      if(!element)continue;
      if(setting.type==='bool')element.value=String(Boolean(setting.value));
      else if(setting.type==='enum')element.value=setting.value;
      else if(!setting.secret||!setting.hasValue)element.value=setting.type==='json'||setting.type==='list'?JSON.stringify(setting.value):(setting.value??'');
    }
    $('settingsFilter').addEventListener('input',()=>{
      const query=$('settingsFilter').value.trim().toLowerCase();
      document.querySelectorAll('.setting').forEach((row)=>{row.classList.toggle('hidden',Boolean(query)&&!row.getAttribute('data-search').includes(query))});
      document.querySelectorAll('.settings-group').forEach((group)=>{
        const visible=[...group.querySelectorAll('.setting:not(.hidden)')].length;
        group.classList.toggle('hidden',visible===0);
        if(query&&visible>0)group.setAttribute('open','');
      });
    });
    $('settingsSave').addEventListener('click',async()=>{
      const updates={};
      try{
        document.querySelectorAll('[data-key]').forEach((element)=>{
          const key=element.getAttribute('data-key');
          const meta=data.settings.find((entry)=>entry.key===key);
          if(!meta)return;
          let value;
          if(meta.type==='bool')value=element.value==='true';
          else if(meta.type==='int'||meta.type==='float')value=element.value===''?undefined:Number(element.value);
          else if(meta.type==='json'){try{value=element.value.trim()===''?null:JSON.parse(element.value)}catch{throw new Error('Invalid JSON for '+meta.label)}}
          else if(meta.type==='list'){try{value=element.value.trim()===''?[]:JSON.parse(element.value)}catch{value=element.value.split(',').map((item)=>item.trim()).filter(Boolean)}}
          else value=element.value;
          if(value===undefined)return;
          if(meta.secret&&(value===''||value==null))return;
          updates[key]=value;
        });
        const result=await api('/settings',{method:'PATCH',body:JSON.stringify(updates)});
        toast('Saved '+result.updated.length+' setting(s)','ok');renderSettings();
      }catch(error){if(error.message!=='unauthorized')toast(error.message,'bad')}
    });
  }catch(error){if(error.message!=='unauthorized')$('view').innerHTML='<div class="empty">'+esc(error.message)+'</div>'}
}

// --------------------------------------------------------------- live events
function connectEvents(){
  const source=new EventSource(BASE+'/api/events'+(ADMIN_TOKEN?'?token='+encodeURIComponent(ADMIN_TOKEN):''));
  source.onopen=()=>{$('connection').className='dot';$('connectionLabel').textContent='live'};
  source.onerror=()=>{$('connection').className='dot off';$('connectionLabel').textContent='reconnecting'};
  source.onmessage=(event)=>{
    try{
      const data=JSON.parse(event.data);
      if(!data.snapshot)return;
      if(location.hash.startsWith('#overview'))renderOverview();
      if(location.hash.startsWith('#requests'))loadRequests();
    }catch{/* ignore malformed frames */}
  };
}

(async function boot(){
  if(!ADMIN_TOKEN){renderLogin();return}
  try{await api('/overview');route();connectEvents()}
  catch(error){if(error.message!=='unauthorized')renderLogin()}
})();
</script>
</body></html>`;
}
