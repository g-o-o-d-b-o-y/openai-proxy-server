// Per-key customer dashboard served at /key/.
//
// The dashboard token is read from the URL fragment (#token=...) so it never
// reaches server logs or Referer headers, then sent as a bearer token to the
// customer API. Layout keeps four headline numbers, one chart, one limits
// panel and one keys table; the rest lives behind details and tooltips.

import { baseCss, clientCore, escapeHtml, hint } from './theme.js';

export function keyDashboardPage({ config }) {
  const title = escapeHtml(config.dashboard.title);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="#000000"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<title>Key dashboard — ${title}</title><style>${baseCss}</style></head>
<body>
<div class="top"><div class="top-inner">
  <a class="brand" href="/"><span class="mark">A</span><span>${title}<small>Key dashboard</small></span></a>
  <span class="spacer"></span>
  <nav class="tabs"><a class="tab" href="/">Home</a><a class="tab" href="${escapeHtml(config.dashboard.path)}/">Admin</a></nav>
</div></div>

<main class="wrap">
  <section id="auth" class="hidden" style="margin-top:38px">
    <div class="card" style="max-width:420px;margin:0 auto">
      <div class="hd"><h3>Open your dashboard</h3>${hint('The dashboard token is shown once when a key is created')}</div>
      <div class="bd" style="display:flex;flex-direction:column;gap:11px">
        <label class="f"><span class="lbl">Dashboard token</span><input id="tokenInput" class="mono" type="password" autocomplete="off" placeholder="dash_…"/></label>
        <button class="btn primary" id="tokenButton">Open dashboard</button>
        <div id="authError" class="bad hidden" style="font-size:12px"></div>
      </div>
    </div>
  </section>

  <section id="dashboard" class="hidden">
    <div class="page-head">
      <div>
        <h1 class="mono" id="keyLine">—</h1>
        <div class="sub" id="accountLine" data-tip="Account identifier shared by all keys"></div>
      </div>
      <div class="row">
        <button class="btn sm" id="connectButton" data-tip="Ready-to-run request snippet">Connect</button>
        <button class="btn sm" id="refreshButton" data-tip="Reload usage and requests">Refresh</button>
        <button class="btn sm ghost" id="signOutButton">Sign out</button>
      </div>
    </div>

    <div class="grid cols4" id="tiles"></div>

    <div class="split" style="margin-top:12px">
      <div class="card">
        <div class="hd"><h3>Daily spend</h3><div class="row" style="gap:6px">${hint('Billed amount per day over the last 30 days')}<span class="muted" id="chartTotal" style="font-size:11.5px">—</span></div></div>
        <div class="bd">
          <div class="chart" id="chart"></div>
          <div class="chart-labels" id="chartLabels"></div>
        </div>
      </div>
      <div class="card">
        <div class="hd"><h3>Key limits</h3><div class="row" style="gap:6px">${hint('Usage measured over each rolling window')}<span class="muted" style="font-size:11.5px">rolling</span></div></div>
        <div class="bd" id="limits"></div>
      </div>
    </div>

    <div class="card pad0" style="margin-top:12px">
      <div class="hd">
        <h3>Keys</h3>
        <button class="btn sm" id="rotateCurrent" data-tip="Block the current key and create a replacement with the same limits">Replace key</button>
      </div><div class="tablewrap"><table>
        <thead><tr><th>Key</th><th>Status</th><th class="num">30d spend</th><th></th></tr></thead>
        <tbody id="keysBody"></tbody>
      </table></div>
    </div>

    <div class="split" style="margin-top:12px">
      <div class="card pad0">
        <div class="hd"><h3>Recent requests</h3><span class="muted" id="requestCount" style="font-size:12px"></span></div>
        <div class="tablewrap" style="max-height:380px"><table>
          <thead><tr><th>Time</th><th>Type</th><th class="opt">Model</th><th>Status</th><th class="num">Tokens${hint('Input + output tokens reported by the provider')}</th><th class="num">Cost${hint('Billed amount incl. markup')}</th></tr></thead>
          <tbody id="requestBody"></tbody>
        </table></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="card">
          <div class="hd"><h3>Balance</h3><div class="row" style="gap:6px">${hint('Credit from all sources, spent in expiry order')}<button class="btn sm" id="redeemButton" data-tip="Apply a subscription or top-up code">Redeem</button></div></div>
          <div class="bd" id="balance"></div>
        </div>
        <details class="more">
          <summary>Credit history</summary>
          <div class="body" id="creditHistory"></div>
        </details>
      </div>
    </div>
  </section>
</main>

<footer class="foot"><span>${title}</span><span class="muted" data-tip="Only metering metadata is kept: tokens, cost, status and timings">No prompts or audio stored</span></footer>
<script>
${clientCore}
const TOKEN_KEY='opx_dashboard_token';
let TOKEN=fragmentToken()||loadToken(TOKEN_KEY);
if(fragmentToken())storeToken(TOKEN_KEY,TOKEN);
let STATE=null;

async function api(path,options){
  options=options||{};
  options.headers=Object.assign({'authorization':'Bearer '+TOKEN,'content-type':'application/json'},options.headers||{});
  const response=await fetch(path,options);
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error?.message||('HTTP '+response.status));error.status=response.status;throw error}
  return data;
}

function renderTiles(){
  const account=STATE.account.account;
  const totals=STATE.usage.breakdown.totals;
  const subscription=account.subscription;
  const daysLeft=subscription?Math.max(0,Math.ceil((Date.parse(subscription.expires_at)-Date.now())/86400000)):null;
  const tiles=[
    ['Balance',usd(account.balance_usd),hint('Available credit: free + subscription + purchased'),account.free_credit_usd>0?usd(account.free_credit_usd)+' free':null],
    ['Spend · 30d',usd(totals.billedCostUsd),hint('Billed at upstream cost plus markup'),null],
    ['Requests · 30d',fmt(totals.requests),hint('All metered requests incl. errors'),totals.errors?totals.errors+' errors':null],
    ['Plan',subscription?subscription.plan_code:'None',hint('Subscriptions exempt this account from the per-IP key limit'),subscription?daysLeft+' days left':'pay as you go']
  ];
  $('tiles').innerHTML=tiles.map((tile)=>'<div class="card metric"><span class="lbl">'+esc(tile[0])+tile[2]+'</span><b>'+esc(tile[1])+'</b>'+(tile[3]?'<small>'+esc(tile[3])+'</small>':'')+'</div>').join('');
}

function renderChart(){
  const series=STATE.usage.series||[];
  const max=Math.max(1e-9,...series.map((point)=>point.billedCostUsd));
  if(!series.length){$('chart').innerHTML='<div class="empty" style="flex:1;padding:0">No usage yet — send your first request.</div>';$('chartLabels').innerHTML='';$('chartTotal').textContent='—';return}
  $('chart').innerHTML=series.map((point)=>'<div class="cbar" style="height:'+Math.max(2,Math.round(point.billedCostUsd/max*100))+'%" data-tip="'+esc(point.day+' · '+usd(point.billedCostUsd)+' · '+fmt(point.requests)+' req')+'"></div>').join('');
  $('chartLabels').innerHTML=series.map((point)=>'<span>'+esc(point.day.slice(5))+'</span>').join('');
  $('chartTotal').textContent=usd(series.reduce((sum,point)=>sum+point.billedCostUsd,0))+' total';
}

function limitRow(label,tip,used,max,windowLabel,format){
  const left=Math.max(0,Math.min(100,Math.round((1-Math.min(used,max)/max)*100)));
  const cls=left<=15?'bad':left<=50?'warn':'ok';
  return '<div class="bar-row"><span class="row" style="gap:5px">'+esc(label)+hint(tip)+'</span>'+limitBar(left,cls)+
    '<span class="bar-val">'+esc(format(used))+' / '+esc(format(max))+' · '+esc(windowLabel)+'</span></div>';
}

function renderLimits(){
  const key=STATE.account.current_key;
  const usage=STATE.account.limits_usage||{};
  if(!key){$('limits').innerHTML='<div class="empty">No current key</div>';return}
  const rows=[];
  if(key.limits.spend)rows.push(limitRow('Spend','Billed amount allowed in the window',usage.spend_usd||0,key.limits.spend.max_usd,key.limits.spend.window_hours+'h',usd));
  if(key.limits.requests)rows.push(limitRow('Requests','Request count allowed in the window',usage.requests||0,key.limits.requests.max,key.limits.requests.window_hours+'h',fmt));
  if(key.limits.tokens)rows.push(limitRow('Tokens','Input + output tokens allowed in the window',usage.tokens||0,key.limits.tokens.max,key.limits.tokens.window_hours+'h',compact));
  if(key.limits.rpm)rows.push('<div class="bar-row"><span>Rate</span><span class="muted" style="grid-column:2/4;font-size:12px">'+esc(String(key.limits.rpm))+' requests / minute</span></div>');
  if(key.limits.allowed_models?.length)rows.push('<div class="bar-row"><span>Models</span><span class="muted mono" style="grid-column:2/4;overflow:hidden;text-overflow:ellipsis;font-size:11.5px">'+esc(key.limits.allowed_models.join(', '))+'</span></div>');
  $('limits').innerHTML=rows.length?rows.join(''):'<div class="empty">No explicit limits — the balance is the only cap.</div>';
}

function renderKeys(){
  const currentId=STATE.account.current_key?.id;
  const rows=STATE.account.keys||[];
  $('keysBody').innerHTML=rows.map((key)=>{
    const actions=[];
    if(key.id===currentId&&key.status==='active')actions.push('<button class="btn sm" data-block="'+esc(key.id)+'">Block</button>');
    actions.push('<button class="btn sm" data-rotate="'+esc(key.id)+'" data-tip="Block and replace with the same limits">Replace</button>');
    const meta='Created '+dateFmt(key.created_at)+(key.last_used_at?' · last used '+timeAgo(key.last_used_at):'');
    return '<tr'+(key.id===currentId?' style="background:var(--surface-2)"':'')+'>'+
      '<td><div class="stack"><span class="mono">'+esc(key.key_prefix)+'…'+(key.id===currentId?' <span class="faint" style="font-size:9.5px">current</span>':'')+'</span>'+
      '<small class="trunc" data-tip="'+esc(meta)+'">'+esc(key.name||meta)+'</small></div></td>'+
      '<td>'+keyStatusBadge(key.status)+'</td>'+
      '<td class="num">'+usd(key.usage?.billed_cost_usd||0)+'</td><td class="num">'+actions.join(' ')+'</td></tr>';
  }).join('')||'<tr><td colspan="5"><div class="empty">No keys</div></td></tr>';
}

function renderRequests(){
  const requests=STATE.requests.requests||[];
  $('requestCount').textContent=fmt(STATE.requests.total)+' total';
  $('requestBody').innerHTML=requests.map((request)=>{
    const usage=request.usage||{};
    return '<tr><td class="muted" data-tip="'+esc(request.time)+'">'+esc(timeFmt(request.time))+'</td>'+
      '<td>'+kindBadge(request.kind)+'</td><td class="mono trunc opt" data-tip="'+esc(request.model||'')+'">'+esc(request.model||'—')+'</td>'+
      '<td>'+statusBadge(request.status)+'</td><td class="num">'+fmt(usage.totalTokens||0)+'</td>'+
      '<td class="num">'+usd(request.billedCostUsd||0)+'</td></tr>';
  }).join('')||'<tr><td colspan="6"><div class="empty"><b>No requests yet</b><span>Use <b style="display:inline;color:var(--muted)">Connect</b> to copy a ready-to-run request.</span></div></td></tr>';
}

function renderBalance(){
  const account=STATE.account.account;
  $('balance').innerHTML='<div class="stat-inline">'+
    '<div class="tile"><div class="k">Available</div><div class="v">'+usd(account.balance_usd)+'</div></div>'+
    '<div class="tile"><div class="k">Free</div><div class="v">'+usd(account.free_credit_usd)+'</div></div>'+
    '</div>'+
    '<div class="stat-inline" style="margin-top:8px">'+
    '<div class="tile"><div class="k">Subscription</div><div class="v">'+usd(account.subscription_credit_usd)+'</div></div>'+
    '<div class="tile"><div class="k">Purchased</div><div class="v">'+usd(account.purchased_credit_usd)+'</div></div>'+
    '</div>';
  const credits=STATE.account.credits||[];
  $('creditHistory').innerHTML=credits.length
    ?'<div class="credit-list">'+credits.map((credit)=>{
      const total=Number(credit.amount_usd)||Number(credit.remaining_usd)||0;
      const remaining=Number(credit.remaining_usd)||0;
      const pct=total>0?Math.max(0,Math.min(100,Math.round(remaining/total*100))):0;
      const days=credit.expires_at?Math.max(0,Math.ceil((Date.parse(credit.expires_at)-Date.now())/86400000)):null;
      const expiry=credit.expires_at?(days===0?'expires today':days+' day'+(days===1?'':'s')+' left'):'never expires';
      return '<div class="credit">'+
        '<div class="top"><span class="badge">'+esc(credit.source)+'</span><span class="amt">'+usd(remaining)+'</span></div>'+
        '<span class="bar"><i style="width:'+pct+'%"></i></span>'+
        '<div class="sub"><span>'+usd(total)+' granted</span><span data-tip="Expires '+esc(dateFmt(credit.expires_at))+'">'+esc(expiry)+'</span></div>'+
        '</div>';
    }).join('')+'</div>'
    :'<div class="empty" style="padding:8px 0">No active credit</div>';
}

async function load(){
  const [account,usage,requests]=await Promise.all([
    api('/v1/account'),
    api('/v1/account/usage?days=30'),
    api('/v1/account/requests?limit=25')
  ]);
  STATE={account,usage,requests};
  const key=account.current_key;
  $('keyLine').textContent=key?key.key_prefix+'…':'account '+account.account.id;
  $('accountLine').textContent='account '+account.account.id+' · '+account.key_count+' key'+(account.key_count===1?'':'s');
  renderTiles();renderChart();renderLimits();renderKeys();renderRequests();renderBalance();
}

function showKey(data,note){
  const modal=openModal({
    title:'New API key',
    subtitle:'Shown only once — store it now',
    body:'<div class="secret"><code class="mono" id="modalKey">'+esc(data.key)+'</code><button class="btn sm" id="copyKey">Copy</button></div>'+
      (data.dashboard_url?'<div class="secret"><code class="mono" id="modalDashboard">'+esc(data.dashboard_url)+'</code><button class="btn sm" id="copyDashboard">Copy</button></div>':'')+
      (note?'<p class="m-note">'+esc(note)+'</p>':''),
    actions:'<button class="btn primary" id="modalClose">Done</button>'
  });
  modal.querySelector('#copyKey').addEventListener('click',()=>copy(data.key,'API key'));
  if(data.dashboard_url)modal.querySelector('#copyDashboard').addEventListener('click',()=>copy(data.dashboard_url,'Dashboard link'));
  modal.querySelector('#modalClose').addEventListener('click',()=>modal.remove());
}

function showRedeem(){
  const modal=openModal({
    title:'Redeem a code',
    subtitle:'Applies to this account and all of its keys',
    body:'<label class="f"><span class="lbl">Code'+hint('Single-use subscription or top-up code')+'</span><input id="redeemCode" class="mono" placeholder="OPX-XXXX-XXXX-XXXX" autocomplete="off"/></label>',
    actions:'<button class="btn" id="redeemCancel">Cancel</button><button class="btn primary" id="redeemConfirm">Redeem</button>'
  });
  modal.querySelector('#redeemCode').focus();
  modal.querySelector('#redeemCancel').addEventListener('click',()=>modal.remove());
  modal.querySelector('#redeemConfirm').addEventListener('click',async()=>{
    const code=modal.querySelector('#redeemCode').value.trim();
    if(!code)return;
    try{
      const data=await api('/v1/account/redeem',{method:'POST',body:JSON.stringify({code})});
      toast('Code redeemed: '+data.result.kind,'ok');modal.remove();await load();
    }catch(error){toast(error.message,'bad')}
  });
}

function showConnect(){
  const base=location.origin+'/v1';
  const snippet=['export OPENAI_BASE_URL="'+base+'"','export OPENAI_API_KEY="sk-opx-..."','',
    'curl "$OPENAI_BASE_URL/chat/completions" \\\\',
    '  -H "Authorization: Bearer $OPENAI_API_KEY" \\\\',
    '  -H "Content-Type: application/json" \\\\',
    '  -d \\'{"messages":[{"role":"user","content":"Hello"}]}\\''].join('\\n');
  const modal=openModal({
    title:'Connect a client',
    subtitle:'Any OpenAI-compatible SDK works with this endpoint',
    wide:true,
    body:'<div class="m-section"><span class="sec-title">Base URL'+hint('API keys from this account work here')+'</span>'+
      '<div class="secret"><code class="mono" id="connectBase">'+esc(base)+'</code><button class="btn sm" id="copyConnectBase">Copy</button></div></div>'+
      '<div class="m-section"><span class="sec-title">Example request</span><pre class="pre" id="connectSnippet" style="margin:0"></pre></div>'+
      '<p class="m-note">Replace <span class="mono">sk-opx-...</span> with an API key from this account, then run the request.</p>',
    actions:'<button class="btn" id="copyConnectSnippet">Copy snippet</button><button class="btn primary" id="connectDone">Done</button>'
  });
  modal.querySelector('#connectSnippet').textContent=snippet;
  modal.querySelector('#copyConnectBase').addEventListener('click',()=>copy(base,'Base URL'));
  modal.querySelector('#copyConnectSnippet').addEventListener('click',()=>copy(snippet,'Snippet'));
  modal.querySelector('#connectDone').addEventListener('click',()=>modal.remove());
}

async function blockKey(id){
  const confirmed=await confirmModal({
    title:'Block this key?',
    subtitle:'Requests using it stop immediately',
    body:'<p class="m-note">The key stays on the account and this dashboard keeps working, so you can replace or manage it later. Nothing is deleted.</p>',
    confirmLabel:'Block key',
    danger:true
  });
  if(!confirmed)return;
  try{
    await api('/v1/keys/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:'blocked'})});
    toast('Key blocked','ok');await load();
  }catch(error){toast(error.message,'bad')}
}

async function replaceKey(id){
  const confirmed=await confirmModal({
    title:'Replace this key?',
    subtitle:'Blocks the current key and creates a new one',
    body:'<div class="m-section"><div class="m-kv"><span class="k">Current key</span><span class="v">blocked immediately</span></div>'+
      '<div class="m-kv"><span class="k">Replacement</span><span class="v">same account, limits and balance</span></div>'+
      '<div class="m-kv"><span class="k">Your clients</span><span class="v">update them with the new key</span></div></div>',
    confirmLabel:'Replace key'
  });
  if(!confirmed)return;
  try{
    const data=await api('/v1/keys/'+encodeURIComponent(id)+'/rotate',{method:'POST'});
    showKey(data,'Replacement created. Update your clients with the new key.');
    await load();
  }catch(error){toast(error.message,'bad')}
}

async function openDashboard(){
  try{
    await api('/v1/account');
    $('auth').classList.add('hidden');$('dashboard').classList.remove('hidden');
    await load();
  }catch(error){
    if(error.status===401||error.status===403){clearToken(TOKEN_KEY);TOKEN=''}
    $('dashboard').classList.add('hidden');$('auth').classList.remove('hidden');
    $('authError').textContent=error.message;$('authError').classList.remove('hidden');
  }
}

$('tokenButton').addEventListener('click',()=>{const value=$('tokenInput').value.trim();if(!value)return;TOKEN=value;storeToken(TOKEN_KEY,value);openDashboard()});
$('signOutButton').addEventListener('click',()=>{clearToken(TOKEN_KEY);TOKEN='';location.reload()});
$('refreshButton').addEventListener('click',()=>load().then(()=>toast('Refreshed','ok')).catch((error)=>toast(error.message,'bad')));
$('connectButton').addEventListener('click',showConnect);
$('redeemButton').addEventListener('click',showRedeem);
$('keysBody').addEventListener('click',(event)=>{
  const blockButton=event.target.closest('[data-block]');
  const rotateButton=event.target.closest('[data-rotate]');
  if(blockButton)blockKey(blockButton.getAttribute('data-block'));
  else if(rotateButton)replaceKey(rotateButton.getAttribute('data-rotate'));
});
$('rotateCurrent').addEventListener('click',()=>{
  const current=STATE?.account.current_key?.id;
  if(!current){toast('No current key','bad');return}
  replaceKey(current);
});
openDashboard();
</script>
</body></html>`;
}
