// content.js v15 – UI API for subscriptions, no iframes/redirects
(function () {
  'use strict';

  function findActiveCaseRoot() {
    return (
      document.querySelector('div.windowViewMode-maximized.active.lafPageHost') ||
      document.querySelector('section[role="tabpanel"].tabContent.active') ||
      document.querySelector('div.windowViewMode-maximized.active') ||
      document.body
    );
  }

  function getAllText(el) { return (el ? el.textContent : '').replace(/\s+/g,' ').trim(); }

  // ── Read ALL field-label items ────────────────────────────────────────────
  function readAllFields(root) {
    const r = root || findActiveCaseRoot();
    const map = {};
    r.querySelectorAll('records-record-layout-item[field-label]').forEach(function(item) {
      const label = item.getAttribute('field-label');
      if (!label) return;
      const valEl =
        item.querySelector('lightning-formatted-text[data-output-element-id="output-field"]') ||
        item.querySelector('span[data-aura-class="uiOutputText"]') ||
        item.querySelector('lightning-formatted-text') ||
        item.querySelector('lightning-formatted-url') ||
        item.querySelector('a') ||
        item.querySelector('dd') ||
        item.querySelector('[class*="output"]');
      if (valEl) {
        const raw = getAllText(valEl);
        if (raw && raw !== label) map[label] = raw;
      }
    });
    return map;
  }

  // ── IDs ───────────────────────────────────────────────────────────────────
  function getCaseId() {
    var m = window.location.href.match(/Case\/([A-Za-z0-9]{15,18})\//);
    if (m) return m[1];
    var ids = Array.from(document.documentElement.innerHTML.matchAll(/\b(500[A-Za-z0-9]{12,15})\b/g)).map(function(m){ return m[1]; });
    var freq = {}; ids.forEach(function(id){ freq[id]=(freq[id]||0)+1; });
    var sorted = Object.entries(freq).sort(function(a,b){ return b[1]-a[1]; });
    return sorted[0] ? sorted[0][0] : null;
  }

  function getAccountId(root) {
    var r = root || findActiveCaseRoot();
    var links = r.querySelectorAll('a[href^="/lightning/r/Account/"][href$="/view"]');
    for (var i=0; i<links.length; i++) {
      var m = links[i].getAttribute('href').match(/\/Account\/([^/]+)\/view/);
      if (m) return m[1];
    }
    var allLinks = document.querySelectorAll('a[href*="/Account/"]');
    for (var j=0; j<allLinks.length; j++) {
      var m2 = allLinks[j].href.match(/Account\/([A-Za-z0-9]{15,18})\//);
      if (m2) return m2[1];
    }
    return null;
  }

  // ── Tab click ─────────────────────────────────────────────────────────────
  function clickTab(tabName) {
    return new Promise(function(resolve) {
      var all = document.querySelectorAll('a[title="'+tabName+'"], a[aria-label="'+tabName+'"], [role="tab"]');
      for (var i=0; i<all.length; i++) {
        var el = all[i];
        var label = (el.getAttribute('title')||el.getAttribute('aria-label')||el.textContent||'').trim();
        if (label !== tabName) continue;
        if (el.closest('.forceChatterFeedInner,.forceChatterFeed,.cuf-feed')) continue;
        if (el.getBoundingClientRect().width === 0) continue;
        el.click();
        setTimeout(function(){ resolve(true); }, 1800);
        return;
      }
      resolve(false);
    });
  }

  // ── Fetch helper (same-origin, uses session cookie) ───────────────────────
  function sfFetch(path) {
    var base = window.location.origin;
    // Try v61 then v59
    var tryFetch = function(versions) {
      if (!versions.length) return Promise.resolve(null);
      var ver = versions[0];
      var url = base + path.replace('{v}', ver);
      return fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      }).then(function(r) {
        if (r.ok) return r.json();
        if (r.status === 404) return tryFetch(versions.slice(1));
        return r.json().then(function(e) { return { _error: r.status, _msg: JSON.stringify(e) }; }).catch(function(){ return { _error: r.status }; });
      }).catch(function(e) {
        return { _error: 'fetch-failed', _msg: e.message };
      });
    };
    return tryFetch(['v61.0', 'v59.0', 'v57.0']);
  }

  // ── Get subscriptions via Salesforce APIs ─────────────────────────────────
  function fetchSubscriptions(accountId) {
    var results = { subs: [], methods: [], errors: [], extra: {} };

    // API 1: UI API related list records (most specific)
    var api1 = sfFetch('/services/data/{v}/ui-api/related-list-records/' + accountId + '/Subscriptions__r')
      .then(function(d) {
        if (!d || d._error) { results.errors.push('rl-records:' + (d && d._error || 'null')); return; }
        var recs = d.records || [];
        if (recs.length > 0) {
          results.subs = recs.map(function(rec) {
            var f = rec.fields || {};
            return {
              title:   (f.Subscription_Title__c && f.Subscription_Title__c.value) || (f.Name && f.Name.value) || '',
              product: (f.Subscription_Product__c && f.Subscription_Product__c.value) || '',
              hosting: (f.Hosting_Name__c && f.Hosting_Name__c.value) || ''
            };
          });
          results.methods.push('ui-api-rl:' + results.subs.length);
        } else {
          results.methods.push('ui-api-rl:empty');
        }
      });

    // API 2: SOQL query
    var q = "SELECT Id,Name,Subscription_Title__c,Subscription_Product__c,Hosting_Name__c FROM Subscription__c WHERE Account__c='" + accountId + "' LIMIT 25";
    var api2 = sfFetch('/services/data/{v}/query?q=' + encodeURIComponent(q))
      .then(function(d) {
        if (!d || d._error) { results.errors.push('soql-sub:' + (d && d._error || 'null')); return; }
        var recs = d.records || [];
        if (recs.length > 0 && results.subs.length === 0) {
          results.subs = recs.map(function(rec) {
            return {
              title:   rec.Subscription_Title__c || rec.Name || '',
              product: rec.Subscription_Product__c || '',
              hosting: rec.Hosting_Name__c || ''
            };
          });
          results.methods.push('soql-sub:' + results.subs.length);
        } else {
          results.methods.push('soql-sub:' + (d._error || 'empty'));
        }
      });

    // API 3: Get related list info to discover what's available
    var api3 = sfFetch('/services/data/{v}/ui-api/related-list-info/' + accountId)
      .then(function(d) {
        if (!d || d._error) { results.errors.push('rl-info:' + (d && d._error || 'null')); return; }
        var lists = (d.relatedLists || []).map(function(l){ return l.relatedListId + '(' + l.label + ')'; });
        results.extra.availableLists = lists.slice(0, 15);
        results.methods.push('rl-info:' + lists.length + 'lists');

        // Try subscription-related lists
        var subLists = (d.relatedLists || []).filter(function(l){ return /subscri|hosting|cloud/i.test(l.label||''); });
        return Promise.all(subLists.slice(0,3).map(function(list) {
          return sfFetch('/services/data/{v}/ui-api/related-list-records/' + accountId + '/' + list.relatedListId)
            .then(function(d2) {
              if (d2 && !d2._error && d2.records && d2.records.length > 0 && results.subs.length === 0) {
                results.subs = d2.records.map(function(rec) {
                  var f = rec.fields || {};
                  return { title: (f.Name && f.Name.value)||'', product:'', hosting:'' };
                });
                results.methods.push('rl-discovered:' + list.label + ':' + results.subs.length);
              }
            }).catch(function(){});
        }));
      });

    return Promise.all([api1, api2, api3]).then(function(){ return results; });
  }

  // ── Parse description for subscription name ───────────────────────────────
  function parseSubsFromDescription(description) {
    if (!description) return [];
    var m = description.match(/Subscription[s]?\s*(?:affected|:)[:\s]+([^\n<,]+)/i);
    if (m) {
      var title = m[1].replace(/<[^>]+>/g,'').trim();
      if (title && title.length < 100) return [{ title: title, product:'', hosting:'' }];
    }
    return [];
  }

  // ── Slug helpers ──────────────────────────────────────────────────────────
  function isValidHostingSlug(slug) {
    var name = slug.split('.')[0];
    if (!name || name.length > 30) return false;
    if (/ticket[a-z0-9]{5,}/i.test(name)) return false;
    if (/autopanic|drutiny/i.test(name)) return false;
    if (/-[a-z0-9]{10,}$/i.test(name)) return false;
    return true;
  }
  function extractProdSlugs(text) {
    var raw = Array.from((text||'').matchAll(/\b([a-z0-9_-]+\.prod)\b/gi)).map(function(m){ return m[1].toLowerCase(); });
    return raw.filter(function(s,i){ return raw.indexOf(s)===i; }).filter(isValidHostingSlug);
  }
  function extractAnySlugs(text) {
    var raw = Array.from((text||'').matchAll(/\b([a-z0-9_-]+\.(?:prod|test|dev))\b/gi)).map(function(m){ return m[1].toLowerCase(); });
    return raw.filter(function(s,i){ return raw.indexOf(s)===i; }).filter(isValidHostingSlug);
  }
  function dedupeBy(arr, fn) {
    var s = new Set();
    return arr.filter(function(x){ var k=fn(x); if(s.has(k))return false; s.add(k); return true; });
  }

  function buildCommands(subs, instance, uuid) {
    var cmds = [];
    if (uuid && /^[0-9a-f-]{36}$/i.test(uuid)) {
      cmds.push({ slug: uuid, label: instance||'Instance', cmd: 'aht app:find --uuid ' + uuid });
    }
    var cmdMap = new Map();
    var add = function(text, label) {
      var sl = extractProdSlugs(text||'');
      if (!sl.length) sl = extractAnySlugs(text||'');
      sl.forEach(function(slug){ if(!cmdMap.has(slug)) cmdMap.set(slug, label||slug); });
    };
    (subs||[]).forEach(function(s){ add((s.hosting||'')+' '+(s.title||''), s.title||s.hosting); });
    if (instance) add(instance, instance);
    cmdMap.forEach(function(label,slug){ cmds.push({ slug:slug, label:label, cmd:'aht @'+slug+' -l' }); });
    return cmds;
  }

  function findCaseNumber(fields) {
    if (fields['Case Number']) return fields['Case Number'];
    var text = document.documentElement.innerText||'';
    var matches = Array.from(text.matchAll(/\b(\d{8})\b/g)).map(function(m){ return m[1]; });
    var freq = {}; matches.forEach(function(n){ freq[n]=(freq[n]||0)+1; });
    var sorted = Object.entries(freq).sort(function(a,b){ return b[1]-a[1]; });
    return sorted[0] ? sorted[0][0] : null;
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  function scrape() {
    var steps = ['start'];

    return clickTab('Details').then(function(clicked) {
      steps.push(clicked ? 'details-clicked' : 'no-details-tab');

      var root = findActiveCaseRoot();
      steps.push('root:' + (root === document.body ? 'BODY' : 'DIV✓'));

      var allFields = readAllFields(root);
      steps.push('fields:' + Object.keys(allFields).length);

      var accountName = allFields['Account Name']  || '';
      var priority    = allFields['Priority']      || '';
      var status      = allFields['Status']        || '';
      var assignedTo  = allFields['Case Owner']    || allFields['Assigned To'] || '';
      var instance    = allFields['Instance']      || allFields['Instance Name'] || '';
      var subject     = allFields['Subject']       || '';
      var uuid        = allFields['Instance UUID'] || allFields['Application UUID'] || allFields['App UUID'] || '';
      var description = allFields['Description']   || '';
      var caseNum     = findCaseNumber(allFields);
      var accountId   = getAccountId(root);
      var caseId      = getCaseId();

      steps.push('uuid=' + (!!uuid) + ' acctId=' + (!!accountId));

      var feedPromise = clicked ? clickTab('Feed') : Promise.resolve(false);

      return feedPromise.then(function() {
        var descSubs = parseSubsFromDescription(description);
        steps.push('desc-subs:' + descSubs.length);

        var apiPromise = accountId
          ? fetchSubscriptions(accountId)
          : Promise.resolve({ subs: [], methods: ['no-account-id'], errors: [], extra: {} });

        return apiPromise.then(function(apiResult) {
          steps.push('api:' + apiResult.methods.join(','));
          if (apiResult.errors.length) steps.push('errs:' + apiResult.errors.join(','));

          var subscriptions = apiResult.subs.length > 0 ? apiResult.subs : descSubs;
          subscriptions = dedupeBy(subscriptions, function(s){ return s.title + s.hosting; });
          steps.push('final:' + subscriptions.length);

          var panicCommands = buildCommands(subscriptions, instance, uuid);

          return {
            url: window.location.href, caseId: caseId, accountId: accountId,
            caseNumber: caseNum, accountName: accountName, priority: priority,
            status: status, assignedTo: assignedTo, instance: instance,
            subject: subject, uuid: uuid, subscriptions: subscriptions,
            panicCommands: panicCommands,
            debug: {
              steps: steps, caseId: caseId, accountId: accountId,
              allFieldValues: allFields, apiResult: apiResult,
              domFieldsFound: { accountName:accountName, priority:priority, status:status, assignedTo:assignedTo, instance:instance, subject:subject, uuid:uuid }
            }
          };
        });
      });
    });
  }

  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.type === 'SCRAPE_CASE') {
      scrape()
        .then(function(d){ sendResponse({ success:true, data:d }); })
        .catch(function(e){ sendResponse({ success:false, error:e.message }); });
      return true;
    }
  });
})();
