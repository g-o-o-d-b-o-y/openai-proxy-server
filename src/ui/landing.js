// Public landing page: one primary action (create a key), compact steps and
// pricing, and an interactive quickstart (cURL / Node / Python) where the
// freshly created key is injected into the snippets immediately.
//
// Snippets are built server-side with __BASE__/__KEY__ placeholders and
// JSON-embedded, then filled in the browser: this keeps shell/Python quoting
// out of nested template literals entirely.

import { baseCss, clientCore, escapeHtml, hint } from './theme.js';

function planCard(plan) {
  return `
  <div class="card">
    <div class="bd">
      <div class="row" style="justify-content:space-between">
        <h3>${escapeHtml(plan.name)}</h3>
        <span class="badge">${plan.durationDays} days</span>
      </div>
      <div style="font-size:21px;font-weight:700;letter-spacing:-.03em;margin:7px 0 2px">$${plan.priceUsd.toFixed(0)}
        <span class="muted" style="font-size:12px;font-weight:450">/ ${plan.durationDays} days</span>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:7px">
        <span class="muted" style="font-size:11.5px">${hint(`${plan.creditUsd.toFixed(2)} USD of usage credit, billed at upstream + markup`)} $${plan.creditUsd.toFixed(0)} credit</span>
        <span class="muted" style="font-size:11.5px" data-tip="All keys on the account share this balance and skip the per-IP key limit">Shared balance</span>
      </div>
    </div>
  </div>`;
}

// Chat, TTS and STT examples with placeholders; quoting stays here in plain
// Node strings instead of nested browser template literals.
function buildTemplates(config) {
  const model = config.upstreams.llm.model || 'gpt-4o-mini';
  const ttsModel = config.upstreams.tts.model || 'tts-1';
  const ttsVoice = config.upstreams.tts.voice || 'alloy';
  const sttModel = config.upstreams.stt.model || 'whisper-1';
  const chat = {
    curl: [
      'export OPENAI_BASE_URL="__BASE__"',
      'export OPENAI_API_KEY="__KEY__"',
      '',
      'curl "$OPENAI_BASE_URL/chat/completions" \\',
      '  -H "Authorization: Bearer $OPENAI_API_KEY" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`
    ].join('\n'),
    node: [
      "import OpenAI from 'openai';",
      '',
      'const client = new OpenAI({',
      "  baseURL: '__BASE__',",
      "  apiKey: '__KEY__',",
      '});',
      '',
      'const chat = await client.chat.completions.create({',
      `  model: '${model}',`,
      "  messages: [{ role: 'user', content: 'Hello' }],",
      '});',
      '',
      'console.log(chat.choices[0].message.content);'
    ].join('\n'),
    python: [
      'from openai import OpenAI',
      '',
      'client = OpenAI(',
      "    base_url='__BASE__',",
      "    api_key='__KEY__',",
      ')',
      '',
      'chat = client.chat.completions.create(',
      `    model='${model}',`,
      '    messages=[{"role": "user", "content": "Hello"}],',
      ')',
      '',
      'print(chat.choices[0].message.content)'
    ].join('\n')
  };
  const tts = [
    '# writes raw audio (audio/pcm for this model)',
    'curl "$OPENAI_BASE_URL/audio/speech" \\',
    '  -H "Authorization: Bearer $OPENAI_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    '  -o speech.pcm \\',
    `  -d '{"model":"${ttsModel}","voice":"${ttsVoice}","input":"Hello from the API"}'`
  ].join('\n');
  const stt = [
    'AUDIO=$(base64 < audio.wav | tr -d "\\n")',
    '',
    'curl "$OPENAI_BASE_URL/audio/transcriptions" \\',
    '  -H "Authorization: Bearer $OPENAI_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{"model":"${sttModel}","input_audio":{"data":"'"$AUDIO"'","format":"wav"}}'`
  ].join('\n');
  return { chat, tts, stt };
}

export function landingPage({ config, plans, freeCreditUsd }) {
  const title = escapeHtml(config.dashboard.title);
  const currency = (value) => `$${Number(value || 0).toFixed(2)}`;
  const limit = Number(config.keys.ipLimitPerMonth) || 0;
  const templates = JSON.stringify(buildTemplates(config)).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="theme-color" content="#000000"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<title>${title}</title><style>${baseCss}</style></head>
<body>
<div class="top"><div class="top-inner">
  <a class="brand" href="/"><span class="mark">A</span><span>${title}<small>OpenAI-compatible API</small></span></a>
  <span class="spacer"></span>
  <nav class="tabs">
    <a class="tab" href="/key/" data-tip="Usage, limits and keys for your account">Key dashboard</a>
    <a class="tab" href="${escapeHtml(config.dashboard.path)}/" data-tip="Administrator area">Admin</a>
  </nav>
</div></div>

<main class="wrap">
  <section class="hero">
    <span class="pill"><span class="dot"></span> LLM · TTS · STT · streaming</span>
    <h1>One key for chat, speech and transcription.</h1>
    <p>Generate a key, point any OpenAI SDK at this server, and pay only for what you use —
    ${config.billing.markupPct}% over provider cost, capped by the limits on your key.</p>
    <div class="cta">
      <a class="btn primary" href="#get-key">Get a free API key</a>
      <a class="btn" href="#quickstart">Quickstart</a>
    </div>
  </section>

  <div class="split" id="get-key">
    <div class="card">
      <div class="hd">
        <h3>Create a key</h3>
        <span class="badge">${freeCreditUsd > 0 ? `${currency(freeCreditUsd)} free credit` : 'free'}</span>
      </div>
      <div class="bd" style="display:flex;flex-direction:column;gap:11px">
        <label class="f">
          <span class="lbl">Label ${hint('Optional name to recognise the key later')}</span>
          <input id="keyName" maxlength="60" placeholder="macbook"/>
        </label>
        <button class="btn primary" id="createKey" style="width:100%">Generate API key</button>
        <details class="more" style="border:0;background:none">
          <summary>Add a contact</summary>
          <div class="body" style="padding:4px 0 0">
            <label class="f">
              <span class="lbl">Contact ${hint('Optional email or handle, shown to the administrator')}</span>
              <input id="keyContact" maxlength="120" placeholder="you@example.com"/>
            </label>
          </div>
        </details>
        <div id="createError" class="bad hidden" style="font-size:12px"></div>
      </div>
    </div>
    <div class="card">
      <div class="hd"><h3>Limits</h3></div>
      <div class="bd" style="display:flex;flex-direction:column;gap:8px;font-size:12px">
        <div class="row" style="justify-content:space-between">
          <span class="muted">Keys per IP / month</span>
          <b>${limit > 0 ? limit : 'Unlimited'} ${hint('Self-service allowance per IP address per calendar month. Subscriptions are exempt.')}</b>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="muted">Cooldown</span>
          <b>${config.keys.cooldownSeconds}s ${hint('Minimum wait between two self-service keys from the same IP')}</b>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="muted">Default limits</span>
          <b style="font-weight:550" data-tip="Each new key gets spend, request and rate caps; edit them per key in the dashboard">spend · requests · rpm</b>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="muted">VPN users</span>
          <span class="muted" style="text-align:right;max-width:200px" data-tip="The server sees your VPN address. If it already used its keys this month, disconnect the VPN and retry.">may need to retry without VPN</span>
        </div>
      </div>
    </div>
  </div>

  <section class="card hidden" id="result" style="margin-top:10px;border-color:rgba(250,250,250,.25)">
    <div class="hd"><h3>Key ready</h3><span class="badge warn">shown once</span></div>
    <div class="bd" style="display:flex;flex-direction:column;gap:9px">
      <div class="secret"><code id="newKey" class="mono"></code><button class="btn sm" data-copy="newKey">Copy</button></div>
      <div class="secret"><code id="newDashboard" class="mono"></code><button class="btn sm" data-copy="newDashboard">Copy</button></div>
      <div class="row">
        <a class="btn sm primary" id="openDashboard" href="#" target="_blank" rel="noopener">Open dashboard</a>
        <a class="btn sm" href="#quickstart">Use in quickstart</a>
        <span class="muted" style="font-size:11.5px">Keep the dashboard link private.</span>
      </div>
    </div>
  </section>

  <section class="steps">
    <div class="step"><span class="n">1</span><div><b>Generate</b><span>Instant key, no signup</span></div></div>
    <div class="step"><span class="n">2</span><div><b>Point your client</b><span class="mono" style="font-family:ui-monospace,monospace" data-tip="OpenAI-compatible base URL">/v1</span></div></div>
    <div class="step"><span class="n">3</span><div><b>Track usage</b><span data-tip="Balance, spend chart, limits and request history">per-key dashboard</span></div></div>
  </section>

  ${plans.length ? `<section style="margin-top:24px">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <h2 style="font-size:15px">Subscriptions</h2>
      <span class="muted" style="font-size:11.5px">Redeem codes from your key dashboard</span>
    </div>
    <div class="grid cols2">${plans.map(planCard).join('')}</div>
  </section>` : ''}

  <section id="quickstart" style="margin-top:24px">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <h2 style="font-size:15px">Quickstart</h2>
      <span class="muted" style="font-size:11.5px">Base URL: <span class="mono">/v1</span></span>
    </div>
    <div class="card pad0">
      <div class="hd" style="padding:3px 6px">
        <div class="qs-tabs" role="tablist" aria-label="Client language">
          <button class="tab active" role="tab" aria-selected="true" data-lang="curl">cURL</button>
          <button class="tab" role="tab" aria-selected="false" data-lang="node">Node</button>
          <button class="tab" role="tab" aria-selected="false" data-lang="python">Python</button>
        </div>
        <button class="btn sm" id="qsCopy" data-tip="Copy the current snippet">Copy</button>
      </div>
      <pre class="qs-code" id="qsCode"></pre>
      <div class="qs-meta">
        <button class="pill mono" id="qsBase" data-copy="qsBase" data-tip="Click to copy the API base URL"></button>
        <span class="spacer"></span>
        <span class="muted" id="qsKeyState">API key: not created yet</span>
      </div>
    </div>
    <details class="more" style="margin-top:10px">
      <summary>Speech examples</summary>
      <div class="body" style="display:flex;flex-direction:column;gap:8px;padding-top:10px">
        <div class="row" style="justify-content:space-between"><span class="muted" style="font-size:11.5px">Text to speech → raw audio</span><button class="btn sm" data-copy="ttsCode">Copy</button></div>
        <pre class="pre" id="ttsCode"></pre>
        <div class="row" style="justify-content:space-between;margin-top:4px"><span class="muted" style="font-size:11.5px">Speech to text → JSON transcript</span><button class="btn sm" data-copy="sttCode">Copy</button></div>
        <pre class="pre" id="sttCode"></pre>
      </div>
    </details>
  </section>
</main>

<footer class="foot"><span>${title}</span><span class="muted" data-tip="Only metering metadata is kept: tokens, cost, status and timings">No prompts or audio stored</span></footer>
<script>
${clientCore}
const QS_BASE=location.origin+'/v1';
const QS_TEMPLATES=${templates};
let QS_KEY='sk-opx-...';
let QS_LANG='curl';

const fill=(text)=>String(text).split('__BASE__').join(QS_BASE).split('__KEY__').join(QS_KEY);

function renderQuickstart(){
  const chat=QS_TEMPLATES.chat;
  $('qsCode').textContent=fill(chat[QS_LANG]);
  $('qsBase').textContent=QS_BASE;
  $('ttsCode').textContent=fill(QS_TEMPLATES.tts);
  $('sttCode').textContent=fill(QS_TEMPLATES.stt);
  $('qsKeyState').innerHTML=QS_KEY.startsWith('sk-opx-...')
    ? 'API key: not created yet'
    : 'API key: <span class="ok">inserted</span> <span class="mono">'+esc(QS_KEY.slice(0,12))+'…</span>';
}

document.querySelector('.qs-tabs').addEventListener('click',(event)=>{
  const tab=event.target.closest('[data-lang]');
  if(!tab)return;
  QS_LANG=tab.getAttribute('data-lang');
  document.querySelectorAll('.qs-tabs .tab').forEach((el)=>{
    const active=el===tab;
    el.classList.toggle('active',active);
    el.setAttribute('aria-selected',String(active));
  });
  renderQuickstart();
});
$('qsCopy').addEventListener('click',()=>copy($('qsCode').textContent));
renderQuickstart();

$('createKey').addEventListener('click',async()=>{
  const button=$('createKey');
  button.disabled=true;button.textContent='Creating…';
  $('createError').classList.add('hidden');
  try{
    const response=await fetch('/v1/keys',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({name:$('keyName').value.trim(),contact:$('keyContact').value.trim()})});
    const data=await response.json();
    if(!response.ok){
      $('createError').textContent=data.error?.message||('Request failed ('+response.status+')');
      $('createError').classList.remove('hidden');
      return;
    }
    $('newKey').textContent=data.key;
    $('newDashboard').textContent=data.dashboard_url;
    $('openDashboard').href=data.dashboard_url;
    $('result').classList.remove('hidden');
    QS_KEY=data.key;
    renderQuickstart();
    $('result').scrollIntoView({behavior:'smooth',block:'nearest'});
    toast('API key created and inserted into the snippets','ok');
  }catch(error){
    $('createError').textContent='Network error: '+error.message;
    $('createError').classList.remove('hidden');
  }finally{
    button.disabled=false;button.textContent='Generate API key';
  }
});
document.addEventListener('click',(event)=>{
  const button=event.target.closest('[data-copy]');
  if(!button)return;
  const target=$(button.getAttribute('data-copy'));
  if(target)copy(target.textContent.trim());
});
</script>
</body></html>`;
}
