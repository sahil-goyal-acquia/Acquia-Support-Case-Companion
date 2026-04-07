// popup.js v17 – Cache case data per URL, instant reopen
const mainContent = document.getElementById('mainContent');
const headerCase  = document.getElementById('headerCase');

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function priorityBadge(p){
  if(!p) return '';
  const map={high:'badge-high',critical:'badge-high',medium:'badge-medium',low:'badge-low'};
  return `<span class="badge ${map[p.toLowerCase()]||'badge-default'}">${esc(p)}</span>`;
}
function copyText(text, btn){
  const orig = btn.textContent;
  navigator.clipboard.writeText(text).catch(()=>{
    const t=document.createElement('textarea'); t.value=text;
    document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
  });
  btn.textContent='✓'; btn.classList.add('copied');
  setTimeout(()=>{ btn.textContent=orig; btn.classList.remove('copied'); }, 1600);
}

// ── Per-case storage (notes + hosting slug) ───────────────────────────────────
function caseKey(d){ return 'case_'+(d.caseNumber||d.caseId||d.url); }
function loadCaseStore(k, cb){ chrome.storage.local.get([k], r => cb(r[k]||{})); }
function saveCaseStore(k, obj){ chrome.storage.local.set({[k]: obj}); }

// ── Scraped data cache: keyed by tab URL ──────────────────────────────────────
// 'scrape_cache' = { url: string, data: object }
// We store this in chrome.storage.session (cleared on browser close) so it
// survives popup close/reopen but not browser restart.
// Fallback: chrome.storage.local with a ttl check.
function getCacheKey(url) {
  // Strip hash/query so minor URL variations still hit the same case
  return 'scrape_' + url.replace(/[?#].*/,'').replace(/[^a-zA-Z0-9]/g,'_').substring(0,120);
}

function loadScrapeCache(url, cb) {
  const key = getCacheKey(url);
  const store = chrome.storage.session || chrome.storage.local;
  store.get([key], function(r) {
    const cached = r[key];
    if (!cached) return cb(null);
    // Expire after 30 minutes
    if (Date.now() - (cached.ts||0) > 30 * 60 * 1000) return cb(null);
    cb(cached.data);
  });
}

function saveScrapeCache(url, data) {
  const key = getCacheKey(url);
  const store = chrome.storage.session || chrome.storage.local;
  store.set({ [key]: { ts: Date.now(), data: data } });
}

function clearScrapeCache(url) {
  const key = getCacheKey(url);
  const store = chrome.storage.session || chrome.storage.local;
  store.remove([key]);
}

// ── Build AHT commands from hosting slug ─────────────────────────────────────
function buildHostingCommands(slug) {
  const env = slug.trim().replace(/^@/, '');
  if (!env) return [];
  return [
    { label: 'Find app',  cmd: 'aht @'+env+' a:i' },
    { label: 'Panic',     cmd: 'aht @'+env+' panic -l' },
    { label: 'SSH login', cmd: 'aht @'+env+' ssh html' },
  ];
}

function renderCmdRows(commands, idPrefix) {
  return commands.map(function(c, i) {
    return `<div class="cmd-row">
      <div class="cmd-row-left">
        <span class="cmd-label">${esc(c.label)}</span>
        <span class="cmd-text mono">${esc(c.cmd)}</span>
      </div>
      <button class="copy-btn" data-cmd="${esc(c.cmd)}" id="${idPrefix||'cmd'}${i}">Copy</button>
    </div>`;
  }).join('');
}

// ── Main render ───────────────────────────────────────────────────────────────
function render(data, fromCache) {
  headerCase.textContent = data.caseNumber ? '#'+data.caseNumber : '—';
  const dbg = data.debug||{};
  const nk  = caseKey(data);

  loadCaseStore(nk, function(store) {
    const savedHosting = store.hosting || '';
    const savedNotes   = store.notes   || '';

    const hostingSlug = savedHosting.trim();
    const hostingCmds = hostingSlug ? buildHostingCommands(hostingSlug) : [];
    const uuidCmd     = (!hostingSlug && data.uuid && /^[0-9a-f-]{36}$/i.test(data.uuid))
      ? [{ label: 'Find by UUID', cmd: 'aht app:find --uuid '+data.uuid }]
      : [];
    const allCmds = hostingCmds.length ? hostingCmds : uuidCmd;

    let h = `<div class="content">`;

    // Cache indicator
    if (fromCache) {
      h += `<div class="cache-bar">
        ⚡ Loaded from cache &nbsp;·&nbsp;
        <button class="cache-refresh-btn" id="cacheRefreshBtn">↺ Refresh data</button>
      </div>`;
    }

    // ── Case Overview ──
    h += `<div class="section">
      <div class="section-header"><span class="dot" style="color:#4f8ef7"></span>Case Overview</div>
      <div class="section-body">
        ${data.accountName ? `<div class="field"><span class="field-label">Account</span><span class="field-value">${esc(data.accountName)}</span></div>` : ''}
        ${data.subject     ? `<div class="field"><span class="field-label">Subject</span><span class="field-value">${esc(data.subject)}</span></div>` : ''}
        ${data.priority    ? `<div class="field"><span class="field-label">Priority</span><span class="field-value">${priorityBadge(data.priority)}</span></div>` : ''}
        ${data.status      ? `<div class="field"><span class="field-label">Status</span><span class="field-value">${esc(data.status)}</span></div>` : ''}
        ${data.assignedTo  ? `<div class="field"><span class="field-label">Assigned</span><span class="field-value">${esc(data.assignedTo)}</span></div>` : ''}
        ${data.caseNumber  ? `<div class="field"><span class="field-label">Case #</span><span class="field-value mono">${esc(data.caseNumber)}</span></div>` : ''}
      </div>
    </div>`;

    // ── Instance ──
    if (data.instance || data.uuid) {
      h += `<div class="instance-block">
        <div class="instance-icon">🖥️</div>
        <div style="flex:1;min-width:0">
          ${data.instance ? `<div class="instance-label">Instance</div><div class="instance-value">${esc(data.instance)}</div>` : ''}
          ${data.uuid     ? `<div class="instance-label" style="margin-top:4px">UUID</div>
            <div class="instance-value mono" style="font-size:10px;word-break:break-all;opacity:.8">${esc(data.uuid)}</div>` : ''}
        </div>
      </div>`;
    }

    // ── Hosting input ──
    h += `<div class="section">
      <div class="section-header"><span class="dot" style="color:#22d3a5"></span>Hosting Environment</div>
      <div class="section-body">
        <div style="font-size:10px;color:var(--muted);margin-bottom:6px;font-family:var(--mono)">Enter the env slug to generate AHT commands</div>
        <div class="hosting-input-row">
          <span class="hosting-at">@</span>
          <input class="hosting-input" id="hostingInput" type="text"
            placeholder="e.g. solaredge.prod" value="${esc(savedHosting)}"
            spellcheck="false" autocomplete="off"/>
          <button class="hosting-save-btn" id="hostingSaveBtn">Set</button>
        </div>
        ${hostingSlug ? `<div style="margin-top:6px;font-size:10px;font-family:var(--mono);color:var(--green)">✓ Using: <b>@${esc(hostingSlug)}</b></div>` : ''}
      </div>
    </div>`;

    // ── AHT Commands ──
    h += `<div class="section">
      <div class="section-header"><span class="dot" style="color:#22d3a5"></span>AHT Commands</div>
      <div class="section-body">`;
    if (allCmds.length > 0) {
      h += renderCmdRows(allCmds, 'cmd');
    } else {
      h += `<div style="color:var(--muted);font-size:11px;font-family:var(--mono)">Enter a hosting slug above to generate commands</div>`;
    }
    h += `</div></div>`;

    // ── Notes ──
    h += `<div class="section">
      <div class="section-header"><span class="dot" style="color:#f5a623"></span>Private Notes</div>
      <div class="section-body">
        <textarea class="notes-textarea" id="notesArea"
          placeholder="Passwords, sensitive details, internal context… stored locally only.">${esc(savedNotes)}</textarea>
        <div class="notes-footer">
          <span class="notes-hint">🔒 Local only · never synced</span>
          <button class="notes-save-btn" id="saveBtn">Save</button>
        </div>
      </div>
    </div>`;

    // ── Debug ──
    const steps = (dbg.steps||[]).join(' → ');
    const allFields = dbg.allFieldValues||{};
    h += `<div class="section">
      <div class="section-header" style="cursor:pointer" id="dbgToggle">
        <span class="dot" style="color:#6b758f"></span><span>Debug Info</span>
        <span style="margin-left:auto;font-size:10px;color:var(--muted)" id="dbgArrow">▶ expand</span>
      </div>
      <div id="dbgBody" style="display:none;padding:10px 12px;flex-direction:column;gap:8px">
        <div style="font-size:11px;font-family:var(--mono);line-height:1.9;word-break:break-all">
          <span style="color:var(--muted)">Steps:</span> <span style="color:var(--accent)">${esc(steps||'—')}</span><br>
          <span style="color:var(--muted)">Case:</span> <span style="color:var(--accent)">${esc(dbg.caseId||'—')}</span>
          &nbsp;<span style="color:var(--muted)">Acct:</span> <span style="color:var(--accent)">${esc(dbg.accountId||'—')}</span>
        </div>
        <div>
          <div class="dbg-label">All Case Fields (${Object.keys(allFields).length})</div>
          <div class="raw-sub">${Object.entries(allFields).map(([k,v])=>`<b style="color:var(--accent)">${esc(k)}</b>: ${esc(v)}`).join('\n')||'(none)'}</div>
        </div>
      </div>
    </div>`;

    h += `</div>`;
    h += `<div class="footer">
      <a href="${esc(data.url)}" target="_blank" class="footer-link">↗ Open in Salesforce</a>
      <button class="refresh-btn" id="refreshBtn">↺ Full refresh</button>
    </div>`;

    mainContent.innerHTML = h;

    // Events: copy buttons
    mainContent.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); copyText(btn.dataset.cmd, btn); });
    });

    // Cache refresh button (force re-scrape)
    const cacheRefBtn = document.getElementById('cacheRefreshBtn');
    if (cacheRefBtn) {
      cacheRefBtn.addEventListener('click', () => {
        clearScrapeCache(data.url);
        mainContent.innerHTML = `<div class="state-msg"><div class="state-icon">⚡</div><strong>Refreshing…</strong></div>`;
        init();
      });
    }

    // Hosting input
    const hostingInput = document.getElementById('hostingInput');
    const hostingSaveBtn = document.getElementById('hostingSaveBtn');
    function saveHosting() {
      const val = hostingInput.value.trim().replace(/^@/, '');
      loadCaseStore(nk, function(s) {
        s.hosting = val;
        saveCaseStore(nk, s);
        render(data, fromCache);
      });
    }
    hostingSaveBtn.addEventListener('click', saveHosting);
    hostingInput.addEventListener('keydown', e => { if (e.key==='Enter') saveHosting(); });

    // Notes
    const ta = document.getElementById('notesArea');
    const sb = document.getElementById('saveBtn');
    sb.addEventListener('click', () => {
      loadCaseStore(nk, function(s) {
        s.notes = ta.value;
        saveCaseStore(nk, s);
        sb.textContent='✓ Saved'; sb.classList.add('saved');
        setTimeout(()=>{ sb.textContent='Save'; sb.classList.remove('saved'); }, 1800);
      });
    });
    ta.addEventListener('keydown', e => { if ((e.ctrlKey||e.metaKey)&&e.key==='s'){ e.preventDefault(); sb.click(); } });

    // Debug toggle
    const dbgBody = document.getElementById('dbgBody');
    dbgBody.style.display = 'none';
    document.getElementById('dbgToggle').addEventListener('click', () => {
      const open = dbgBody.style.display==='none';
      dbgBody.style.display = open ? 'flex' : 'none';
      document.getElementById('dbgArrow').textContent = open ? '▼ collapse' : '▶ expand';
    });

    // Full refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
      clearScrapeCache(data.url);
      mainContent.innerHTML = `<div class="state-msg"><div class="state-icon">⚡</div><strong>Refreshing…</strong></div>`;
      init();
    });
  });
}

// Styles
const style = document.createElement('style');
style.textContent = `
  .dbg-label{font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px}
  .cache-bar{
    display:flex;align-items:center;gap:6px;
    background:rgba(79,142,247,.08);border:1px solid rgba(79,142,247,.2);
    border-radius:8px;padding:6px 12px;margin:12px 14px 0;
    font-size:10px;font-family:var(--mono);color:var(--muted);
  }
  .cache-refresh-btn{
    background:none;border:none;color:var(--accent);font-family:var(--mono);
    font-size:10px;cursor:pointer;padding:0;text-decoration:underline;
  }
  .cache-refresh-btn:hover{opacity:.8;}
  .hosting-input-row{display:flex;align-items:center;gap:6px}
  .hosting-at{font-family:var(--mono);font-size:15px;font-weight:700;color:var(--green);flex-shrink:0}
  .hosting-input{
    flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:7px;
    color:var(--text);font-family:var(--mono);font-size:12px;padding:7px 10px;outline:none;
    transition:border-color .15s;min-width:0;
  }
  .hosting-input:focus{border-color:var(--green);}
  .hosting-input::placeholder{color:var(--muted);opacity:.5;}
  .hosting-save-btn{
    font-size:11px;font-weight:700;font-family:var(--mono);
    background:rgba(34,211,165,.15);color:var(--green);border:1px solid rgba(34,211,165,.3);
    border-radius:6px;padding:6px 14px;cursor:pointer;transition:all .15s;white-space:nowrap;flex-shrink:0;
  }
  .hosting-save-btn:hover{background:rgba(34,211,165,.25);}
  .cmd-row{
    display:flex;align-items:center;gap:8px;
    background:var(--surface2);border:1px solid var(--border);border-radius:8px;
    padding:8px 10px;margin-bottom:6px;
  }
  .cmd-row:last-child{margin-bottom:0;}
  .cmd-row-left{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
  .cmd-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);font-family:var(--mono);}
  .cmd-text{font-size:12px;font-weight:600;color:var(--green);word-break:break-all;font-family:var(--mono);}
  .copy-btn{
    font-size:10px;font-weight:700;font-family:var(--mono);
    background:none;border:1px solid var(--border);color:var(--muted);
    border-radius:5px;padding:4px 10px;cursor:pointer;transition:all .15s;flex-shrink:0;
  }
  .copy-btn:hover{border-color:var(--green);color:var(--green);}
  .copy-btn.copied{color:var(--green);border-color:var(--green);}
`;
document.head.appendChild(style);

function showError(msg){
  mainContent.innerHTML=`<div class="state-msg">
    <div class="state-icon">⚠️</div><strong>Error</strong><span>${esc(msg)}</span>
    <span style="color:var(--muted);font-size:11px">Open a Salesforce Case and wait for it to fully load.</span>
  </div>`;
}

function scrapeAndCache(tab) {
  chrome.scripting.executeScript({target:{tabId:tab.id}, files:['content.js']}, () => {
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id, {type:'SCRAPE_CASE'}, res => {
        if (chrome.runtime.lastError){ showError('Could not communicate. Refresh the Salesforce tab.'); return; }
        if (!res?.success){ showError('Failed: '+(res?.error||'unknown')); return; }
        saveScrapeCache(tab.url, res.data);
        render(res.data, false);
      });
    }, 600);
  });
}

function init(){
  chrome.tabs.query({active:true, currentWindow:true}, tabs => {
    const tab = tabs[0];
    if (!tab){ showError('No active tab.'); return; }
    if (!tab.url?.includes('force.com') && !tab.url?.includes('salesforce.com')){
      showError('Not a Salesforce page.'); return;
    }

    // Show loading state briefly
    mainContent.innerHTML = `<div class="state-msg"><div class="state-icon" style="font-size:20px">⚡</div><strong style="font-size:12px">Loading…</strong></div>`;

    // Check cache first
    loadScrapeCache(tab.url, function(cached) {
      if (cached) {
        // Instant render from cache
        render(cached, true);
      } else {
        // No cache — scrape fresh
        scrapeAndCache(tab);
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
