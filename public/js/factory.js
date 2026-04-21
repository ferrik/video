
    // Navigation
    const views = ['factory-view', 'queue-view', 'winners-view', 'hooklab-view'];
    function showView(id) { 
      views.forEach(v => document.getElementById(v).style.display = v === id ? 'block' : 'none'); 
      if(window.innerWidth < 768) {
        document.getElementById('nav-btns').classList.remove('active');
      }
    }
    
    function toggleMobileNav() {
      document.getElementById('nav-btns').classList.toggle('active');
    }

    function toggleQueue() { showView('queue-view'); loadQueue(); }
    function toggleHookLab() { showView('hooklab-view'); loadHookLab(); }
    function toggleWinners() { showView('winners-view'); loadWinners(); }

    function toggleAcc() {
      const c = document.getElementById('f-adv');
      const i = document.getElementById('acc-icon');
      c.classList.toggle('open');
      i.textContent = c.classList.contains('open') ? '▼' : '▶';
    }

    // Tools
    const el = id => document.getElementById(id);
    let pollTimer = null;
    let currentJobId = null;

    const ADMIN_KEY_STORAGE = 'creator-os-admin-key';
    function getStoredAdminKey() {
      const stored = (localStorage.getItem(ADMIN_KEY_STORAGE) || '').trim();
      const key = (window.__ADMIN_KEY__ || stored).trim();
      if (key && key !== stored) localStorage.setItem(ADMIN_KEY_STORAGE, key);
      return key;
    }
    function setStoredAdminKey(value) {
      const key = (value || '').trim();
      window.__ADMIN_KEY__ = key;
      if (key) localStorage.setItem(ADMIN_KEY_STORAGE, key);
      else localStorage.removeItem(ADMIN_KEY_STORAGE);
      updateAdminKeyIndicator();
      return key;
    }
    function updateAdminKeyIndicator() {
      const key = getStoredAdminKey();
      const btn = document.getElementById('nav-admin-key');
      if (!btn) return;
      btn.textContent = key ? '🔐 Ключ встановлено' : '🔐 Адмін-ключ';
      btn.style.opacity = key ? '1' : '0.7';
    }
    async function ensureAdminKey(autoPrompt = false) {
      const current = getStoredAdminKey();
      if (current) return current;
      if (!autoPrompt) return '';
      const input = prompt('Введіть Admin API Key для доступу до фабрики:') || '';
      const saved = setStoredAdminKey(input);
      if (!saved) alert('Admin API key потрібен для цієї операції.');
      return saved;
    }
    function promptAdminKey() {
      const key = prompt('Введіть Admin API Key (зберігається лише в цьому браузері):') || '';
      setStoredAdminKey(key);
    }
    (async () => {
      try {
        const cfg = await fetch('/api/config').then(r => r.json());
        if (cfg.adminAuthEnabled) {
          await ensureAdminKey(true);
        } else {
          ensureAdminKey(false);
        }
      } catch (_) {}
      updateAdminKeyIndicator();
    })();
    function apiHeaders(extra = {}) {
      const h = { 'Content-Type': 'application/json', ...extra };
      const key = getStoredAdminKey();
      if (key) h['X-Api-Key'] = key;
      return h;
    }

    // Load initial queue
    async function loadQueue() {
      el('q-list').innerHTML = 'Завантаження...';
      try {
        const res = await fetch('/api/factory/queue');
        if(!res.ok) throw new Error('API Error');
        const data = await res.json();
        renderQueue(data.scenarios || []);
      } catch (e) {
        el('q-list').innerHTML = '<div style="color:var(--red)">Помилка завантаження черги. Перевір бекенд.</div>';
      }
    }

    function renderQueue(list) {
      if(!list.length) {
        el('q-list').innerHTML = '<div style="text-align:center; padding:20px; color:var(--t3)">Черга порожня. Запусти Генерацію для пошуку ідей.</div>';
        return;
      }
      el('q-list').innerHTML = list.filter(s=>s.status==='pending').sort((a,b)=>b.score-a.score).map(s => `
        <div class="q-item">
          <div class="q-score" style="color:${s.score>=75?'var(--green)':s.score>=55?'var(--amber)':'var(--red)'}; background:color-mix(in srgb, currentColor 10%, transparent)">${s.score}</div>
          <div class="q-main">
            <div class="q-title">${s.topic}</div>
            <div class="q-meta">🔥 <b>${s.product}</b> · Ринок: ${s.market} <br/> 💡 Хук: <i>${s.hook}</i></div>
          </div>
          <button class="btn btn-primary" onclick="loadScenario('${btoa(encodeURIComponent(JSON.stringify(s)))}')">▶ Вибрати</button>
        </div>
      `).join('');
    }

    async function generateQueue() {
      el('btn-gen-q').innerHTML = '<span class="spin">↻</span> Думаю...';
      el('btn-gen-q').disabled = true;
      try {
        const res = await fetch('/api/factory/queue/generate', {
          method: 'POST',
          headers: apiHeaders(),
          body: JSON.stringify({
            count: 5, 
            market: el('q-market').value || 'AU',
            niche: el('q-niche').value || 'pest control'
          })
        });
        const respData = await res.json();
        if(!res.ok) {
          const detailStr = respData.details ? ` (${respData.details})` : '';
          throw new Error((respData.error || 'Помилка генерації') + detailStr);
        }
        await loadQueue();
      } catch (e) {
        alert('Помилка генерації: ' + e.message);
      } finally {
        el('btn-gen-q').innerHTML = '🔄 Генерація';
        el('btn-gen-q').disabled = false;
      }
    }

    function loadScenario(b64) {
      const s = JSON.parse(decodeURIComponent(atob(b64)));
      el('f-topic').value = s.topic;
      el('f-product').value = s.product;
      el('f-market').value = s.market;
      showView('factory-view');
    }

    // Factory Runner
    async function runFactory() {
      const topic = el('f-topic').value.trim();
      const product = el('f-product').value.trim();
      if (!topic) return alert('Будь ласка, вкажи Тему відео');

      el('btn-run').disabled = true;
      el('btn-run').innerHTML = '<span class="spin">↻</span> Створення відео...';
      el('f-idle').style.display = 'none';
      el('f-result').style.display = 'none';
      el('f-status').style.display = 'block';
      el('prog-log').textContent = '';
      updateProg(0, 'Ініціалізація фабрики...');

      try {
        const res = await fetch('/api/factory/run', {
          method: 'POST',
          headers: apiHeaders(),
          body: JSON.stringify({
            topic, product, market: el('f-market').value,
            platforms: el('f-platforms').value,
            durationSec: el('f-duration').value,
            advanced: {
              scenesCount: el('f-scenes').value,
              renderMode: el('f-render-mode').value
            }
          })
        });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || 'Не вдалося запустити процес');
        
        currentJobId = data.id;
        pollTimer = setInterval(pollJob, 2000);
      } catch (e) {
        finishJobWithError(e.message);
      }
    }

    function updateProg(pct, text) {
      el('prog-fill').style.width = pct + '%';
      el('prog-pct').textContent = pct + '%';
      if(text) el('prog-text').textContent = text;
    }

    async function pollJob() {
      if(!currentJobId) return stopPoll();
      try {
        const res = await fetch('/api/factory/jobs/' + currentJobId);
        if(!res.ok) throw new Error('Помилка перевірки статусу');
        const job = await res.json();
        
        // Маппінг статусу для прогрес бару
        const stepMap = {'script_generation':20, 'voice_generation':40, 'clip_fetch':60, 'render_plan':70, 'publish_package':80, 'save_outputs':90, 'completed':100};
        const p = stepMap[job.step] || 10;
        updateProg(p, 'Етап: ' + String(job.step).replace('_', ' '));

        const logs = [...(job.logs||[]), ...(job.warnings||[])].join('\n');
        el('prog-log').textContent = logs;

        if(job.status === 'completed' || job.status === 'failed' || job.status === 'requires_follow_up') {
          stopPoll();
          if(job.status === 'failed') finishJobWithError(job.error);
          else showResult(job.resultPackage || job.result || {});
        }
      } catch (e) { stopPoll(); finishJobWithError(e.message); }
    }

    function stopPoll() { clearInterval(pollTimer); pollTimer = null; }

    function finishJobWithError(msg) {
      el('btn-run').disabled = false;
      el('btn-run').innerHTML = '🎬 Запустити Фабрику';
      updateProg(100, 'Збій системи!');
      el('prog-fill').style.background = 'var(--red)';
      el('prog-log').textContent += '\n\nПОМИЛКА: ' + msg;
    }

    function showResult(res) {
      el('btn-run').disabled = false;
      el('btn-run').innerHTML = '🎬 Запустити Фабрику';
      el('prog-fill').style.background = 'var(--green)';
      updateProg(100, 'Готово!');

      el('f-status').style.display = 'none';
      el('f-result').style.display = 'block';

      el('res-title').textContent = res.title || 'Без назви';
      el('res-caption').textContent = res.caption || 'Текст посту відсутній';
      
      // Симуляція перекладу: у майбутньому бекенд буде повертати res.caption_uk 
      el('res-caption-uk').textContent = res.caption_uk ? "🇺🇦 " + res.caption_uk : "🇺🇦 Переклад посту (очікує оновлення AI-моделі)";

      if (res.affiliateLink) {
        el('res-link').innerHTML = `<a href="${res.affiliateLink}" target="_blank" style="color:var(--blue);text-decoration:underline;">${res.affiliateLink}</a>`;
      } else {
        el('res-link').textContent = 'Посилання не згенеровано';
      }

      const vEl = el('res-video');
      const vPh = el('res-video-ph');
      if(res.videoUrl) {
         vEl.src = res.videoUrl;
         vEl.style.display = 'block';
         vPh.style.display = 'none';
      } else {
         vEl.style.display = 'none';
         vPh.style.display = 'flex';
      }

      // Populate Viral Structure
      const vs = res.viral_structure || res.script;
      if (vs && vs.hook) {
        el('res-viral-card').style.display = 'block';
        el('v-hook').textContent = vs.hook || '';
        el('v-problem').textContent = vs.problem || '';
        el('v-solution').textContent = vs.solution || '';
        el('v-proof').textContent = vs.proof || '';
        el('v-cta').textContent = vs.cta || '';
        
        // Show Score
        const scoreEl = el('v-score');
        if (scoreEl) scoreEl.textContent = `🔥 Score: ${res.hook_score || 0}/100`;
        
        // Show Pool (scored cards)
        const pool = res.hooks_scored && res.hooks_scored.length ? res.hooks_scored : (res.hooks_pool || []).map(t => ({ text: t, score: 0, source: 'db' }));
        const poolEl = el('v-pool');
        if (poolEl) {
          poolEl.innerHTML = pool.length > 0
            ? pool.map(h => {
                const sc = h.score || 0;
                const cls = sc >= 75 ? 'green' : sc >= 50 ? 'amber' : 'red';
                const src = h.source === 'ai' ? '<span class="hook-source ai">AI</span>' : '<span class="hook-source db">DB</span>';
                return `<div class="hook-card" style="margin-bottom:8px;">
                  <div class="hook-score-badge ${cls}">${sc}</div>
                  <div style="flex:1;"><div class="hook-text">${h.text}${src}</div></div>
                  <button class="hook-use-btn" data-hook="${h.text.replace(/"/g,'&quot;')}">⚡ Вставити</button>
                </div>`;
              }).join('')
            : 'Немає альтернатив';
        }
      } else {
        const viralCard = el('res-viral-card');
        if (viralCard) viralCard.style.display = 'none';
      }
      
      const scenes = res.scenes || [];
      if (scenes.length > 0) {
        const textArr = scenes.map(s => `- ${s.on_screen_text}`);
        el('v-overlays').textContent = textArr.join('\n');
      } else {
        el('v-overlays').textContent = 'Відсутній текст';
      }
    }

    function resetFactory() {
      el('f-result').style.display = 'none';
      el('f-idle').style.display = 'block';
      el('f-topic').value = '';
      el('f-product').value = '';
      el('btn-run').innerHTML = '🎬 Запустити Фабрику';
      el('prog-fill').style.background = 'var(--green)';
    }

    function copyPkg() {
      const text = [
        "Title: " + el('res-title').textContent, 
        "Caption: " + el('res-caption').textContent, 
        "Link: " + el('res-link').textContent
      ].join('\n\n');
      navigator.clipboard.writeText(text);
      alert('Скопійовано до буфера обміну!');
    }

    // ── Hook Lab ────────────────────────────────────────────────────────────────

    // All known niches per market (mirrors HOOK_DB keys + universal)
    const NICHE_HINTS = {
      UK: ['home security', 'solar', 'lawn'],
      US: ['dog toys', 'home security', 'solar'],
      CA: ['winter', 'tools'],
      UNIVERSAL: ['home security', 'solar', 'lawn', 'dog toys', 'winter', 'tools']
    };

    // Suggested products per market + niche for auto-fill in Factory
    const PRODUCT_HINTS = {
      UK: {
        'home security': 'Ring Video Doorbell 4 — £89.99',
        'solar':         'EcoFlow RIVER 2 Pro — £299',
        'lawn':          'Bosch Rotak 40 Electric Lawn Mower — £119'
      },
      US: {
        'dog toys':      'KONG Classic Dog Toy (Large) — $14.99',
        'home security': 'Ring Alarm 5-piece Security Kit — $199',
        'solar':         'Jackery Explorer 300 Portable Power Station — $259'
      },
      CA: {
        'winter':        'Mr. Heater Portable Buddy — CA$109',
        'tools':         'DEWALT 20V MAX Cordless Drill — CA$149'
      }
    };

    function getProductHint(market, niche) {
      const m = (market || 'US').toUpperCase();
      const n = (niche || '').toLowerCase();
      const mHints = PRODUCT_HINTS[m] || PRODUCT_HINTS['US'];
      // Exact key match first
      if (mHints[n]) return mHints[n];
      // Partial match
      for (const [key, val] of Object.entries(mHints)) {
        if (n.includes(key) || key.split(' ').some(w => n.includes(w))) return val;
      }
      return '';
    }

    function updateNicheDatalist(niches) {
      const dl = document.getElementById('hl-niche-list');
      if (!dl) return;
      dl.innerHTML = niches.map(n => `<option value="${n}">`).join('');
    }

    let _hlDebounce = null;
    async function loadHookLab() {
      clearTimeout(_hlDebounce);
      _hlDebounce = setTimeout(async () => {
        const market = el('hl-market').value;
        const niche  = (el('hl-niche').value || '').trim();
        const count  = el('hl-count').value;
        el('hl-list').innerHTML = '<div style="color:var(--t3);font-size:13px">⏳ Завантаження...</div>';
        try {
          const params = new URLSearchParams({ market, niche, count });
          const data = await fetch('/api/hooks?' + params).then(r => r.json());
          // Update datalist with niches returned by server for this market
          const serverNiches = data.availableNiches && data.availableNiches.length
            ? data.availableNiches
            : (NICHE_HINTS[market] || NICHE_HINTS.UNIVERSAL);
          updateNicheDatalist(serverNiches);
          el('hl-meta').textContent = `Ринок: ${data.market} · Ніша: ${data.niche} · Знайдено: ${data.count} хуків · Доступні ніші: ${serverNiches.join(', ')}`;
          renderHookLabList(data.hooks || [], market, niche);
        } catch(e) {
          el('hl-list').innerHTML = `<div style="color:var(--red);font-size:13px">Помилка: ${e.message}</div>`;
        }
      }, 350);
    }

    function renderHookLabList(hooks, market, niche) {
      if (!hooks.length) { el('hl-list').innerHTML = '<div style="color:var(--t3);padding:12px">Не знайдено. Спробуй інший ринок або нішу.</div>'; return; }
      const product = getProductHint(market, niche);
      el('hl-list').innerHTML = hooks.map(h => {
        const sc = h.score || 0;
        const cls = sc >= 75 ? 'green' : sc >= 50 ? 'amber' : 'red';
        const barW = Math.max(sc, 4);
        const productHint = product ? `<div style="font-size:10px;color:var(--amber);margin-top:3px;font-family:var(--m);">🏷 ${product}</div>` : '';
        return `<div class="hook-card">
          <div class="hook-score-badge ${cls}">${sc}</div>
          <div style="flex:1;">
            <div class="hook-text">${h.text}</div>
            ${productHint}
            <div class="score-bars">
              <span class="score-pill">😱 fear</span>
              <span class="score-pill">💥 emotion</span>
              <span class="score-pill">🎯 specifics</span>
              <span class="score-pill">✂️ brevity</span>
              <div style="flex:1; background:var(--s2); border-radius:3px; height:4px; margin-top:2px; position:relative;">
                <div style="position:absolute; left:0; top:0; height:4px; width:${barW}%; border-radius:3px; background:${cls==='green'?'var(--green)':cls==='amber'?'var(--amber)':'var(--red)'};transition:width 0.4s;"></div>
              </div>
            </div>
          </div>
          <button class="hook-use-btn"
            data-hook="${h.text.replace(/"/g,'&quot;')}"
            data-market="${(market||'').replace(/"/g,'&quot;')}"
            data-niche="${(niche||'').replace(/"/g,'&quot;')}">⚡ Вставити</button>
        </div>`;
      }).join('');
    }

    function useHook(text, market, niche) {
      // 1. Fill topic with hook text
      el('f-topic').value = text;

      // 2. Sync market
      if (market) el('f-market').value = market;

      // 3. Fill product hint if field is empty
      const product = getProductHint(market || 'US', niche || '');
      if (product && !el('f-product').value.trim()) {
        el('f-product').value = product;
      }

      // 4. Switch to factory view
      showView('factory-view');

      // 5. Flash highlight filled fields
      function flashField(id) {
        const f = el(id);
        if (!f) return;
        f.style.borderColor = 'var(--green)';
        f.style.boxShadow = '0 0 0 3px rgba(16,185,129,0.3)';
        setTimeout(() => { f.style.borderColor = ''; f.style.boxShadow = ''; }, 2000);
      }
      flashField('f-topic');
      if (product) flashField('f-product');

      // 6. Scroll & focus topic
      const tf = el('f-topic');
      tf.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tf.focus();
      tf.select();
    }

    // Delegated click handler for all .hook-use-btn buttons (avoids quote escaping in onclick)
    document.addEventListener('click', function(e) {
      const btn = e.target.closest('.hook-use-btn');
      if (!btn) return;
      const text   = btn.dataset.hook    || '';
      const market = btn.dataset.market  || '';
      const niche  = btn.dataset.niche   || '';
      if (text) useHook(text, market, niche);
    });


    // ── Winners Dashboard ────────────────────────────────────────────────────

    async function loadWinners() {
      el('winners-list').innerHTML = '<div style="color:var(--t3);font-size:13px">⏳ Завантаження...</div>';
      el('ranking-list').innerHTML = '<div style="color:var(--t3);font-size:13px">⏳ Завантаження...</div>';
      try {
        const [wRes, rRes] = await Promise.all([
          fetch('/api/winners').then(r => r.json()),
          fetch('/api/winners/ranking').then(r => r.json())
        ]);

        // Winners
        const winners = wRes.winners || [];
        if (!winners.length) {
          el('winners-list').innerHTML = `<div style="color:var(--t3);font-size:13px;padding:12px">Ще немає переможців (поріг: ${wRes.threshold} кліків). Генеруй відео і перевір ще раз.</div>`;
        } else {
          el('winners-list').innerHTML = winners.map(w => `
            <div class="winner-item">
              <div class="winner-badge">🔥 ${w.clicks} кліків</div>
              <div class="winner-info">
                <div class="winner-title">${w.topic || w.jobId}</div>
                <div class="winner-meta">${w.product} · Hook Score: ${w.hookScore}/100 · ${w.jobId}</div>
              </div>
              <button class="btn btn-primary" style="width:auto;white-space:nowrap" onclick="cloneWinner('${w.jobId}', this)">
                ⚡ Клонувати (×3)
              </button>
            </div>`).join('');
        }

        // Ranking
        const ranking = rRes.ranking || [];
        if (!ranking.length) {
          el('ranking-list').innerHTML = '<div style="color:var(--t3);font-size:13px;padding:12px">Немає даних. Запусти кілька задач.</div>';
        } else {
          el('ranking-list').innerHTML = ranking.map((r, i) => `
            <div class="rank-item">
              <div class="rank-num ${i < 3 ? 'top' : ''}">${i + 1}</div>
              <div class="rank-info">
                <div class="rank-title">${r.topic || r.jobId}</div>
                <div class="rank-scores">Clicks: ${r.clicks} &nbsp;·&nbsp; Hook: ${r.hookScore} &nbsp;·&nbsp; Score: ${r.combinedScore} ${r.isWinner ? '🏆' : ''}</div>
              </div>
            </div>`).join('');
        }
      } catch(e) {
        el('winners-list').innerHTML = `<div style="color:var(--red);font-size:13px">Помилка: ${e.message}</div>`;
      }
    }

    async function cloneWinner(jobId, btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin">⏳</span> Клонування...';
      try {
        const key = await ensureAdminKey(true);
        if (!key) throw new Error('Admin API key потрібен для клонування.');
        const res = await fetch(`/api/winners/${jobId}/clone`, {
          method: 'POST',
          headers: apiHeaders(),
          body: JSON.stringify({ variants: 3 })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Server error');
        btn.innerHTML = `✅ ${data.variantsQueued} варіанти в черзі`;
        btn.style.color = 'var(--green)';
      } catch(e) {
        btn.innerHTML = '❌ Помилка';
        btn.disabled = false;
        alert('Clone failed: ' + e.message);
      }
    }
  