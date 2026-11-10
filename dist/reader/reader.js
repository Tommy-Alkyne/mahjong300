  // 旧版把进度存 localStorage：读到就并进后端状态（并集，谁也不会被覆盖），随后清掉本地键
  async function importLegacyProgress() {
    let changed = false;
    const legacyDone = JSON.parse(readStorage('heqie-done-v1') || 'null');
    if (isMap(legacyDone)) {
      for (const key of Object.keys(legacyDone)) {
        const n = Number(key);
        if (Number.isInteger(n) && n >= 1 && n <= 300 && legacyDone[key] && !done[n]) { done[n] = 1; changed = true; }
      }
    }
    const legacyChoices = JSON.parse(readStorage('heqie-choices-v1') || 'null');
    if (isMap(legacyChoices)) {
      for (const key of Object.keys(legacyChoices)) {
        const n = Number(key), v = Number(legacyChoices[key]);
        if (Number.isInteger(n) && n >= 1 && n <= 300 && Number.isInteger(v) && choices[n] === undefined) { choices[n] = v; changed = true; }
      }
    }
    const legacyCurrent = Number(readStorage('heqie-current-v1'));
    // 更早的版本只记位置不记完成：第一分区内按「顺序做到第几题」补记
    if (doneCount() === 0 && Number.isInteger(legacyCurrent) && legacyCurrent > 1 && legacyCurrent <= 31) {
      for (let i = 1; i < legacyCurrent; i++) done[i] = 1;
      changed = true;
    }
    ['heqie-done-v1', 'heqie-choices-v1', 'heqie-current-v1', 'heqie-migrated-v1'].forEach(dropStorage);
    if (changed) { refreshDone(); await flushSave(); }
  }
'use strict';
(() => {
  const data = window.HEQIE_BOOK;
  const $ = selector => document.querySelector(selector);
  const host = $('#question-host'), menu = $('#reader-menu');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pad = n => String(n).padStart(3, '0');
  const name = t => t[1] === 'z' ? ['牌背','东','南','西','北','白','发','中'][Number(t[0])] : (t[0] === '0' ? '赤五' : '零一二三四五六七八九'[Number(t[0])]) + ({m:'万',p:'筒',s:'索'}[t[1]]);
  const image = (file, alt, cls='scan') => `<img class="${cls}" src="images/${file}" alt="${escape(alt)}" loading="lazy" decoding="async">`;
  const tile = t => `<img src="images/tiles/${t}.png" alt="${name(t)}" draggable="false">`;
  const action = q => (q.action === 'kan' ? '暗杠' : '切') + name(q.discard) + (q.action === 'riichi' ? '并立直' : '');
  const state = q => q.action === 'kan' ? '暗杠后再摸岭上牌' : q.shanten === 0 ? '听牌' : '零一二三四五六'[q.shanten] + '向听';
  // 进度全部存在后端（GET/POST /api/progress），浏览器里只留运行期内存。
  const API = '/api/progress';
  const readStorage = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const dropStorage = key => { try { localStorage.removeItem(key); } catch { /* 无本地存储也能用。 */ } };
  let current = 1, choices = {}, done = {}, stars = {}, saveTimer = null, syncError = false;
  const pendingRemovals = new Set(), pendingUnstars = new Set();
  const isMap = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  function payload() { return { done, stars, choices, current, removed: [...pendingRemovals], unstared: [...pendingUnstars] }; }
  function setSyncError(on) {
    if (syncError === on) return;
    syncError = on; refreshDone();
  }
  async function flushSave() {
    saveTimer = null;
    const body = JSON.stringify(payload());
    try {
      const resp = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const rec = await resp.json();
      if (isMap(rec.done)) done = rec.done;
      if (isMap(rec.stars)) stars = rec.stars;
      if (isMap(rec.choices)) choices = rec.choices;
      pendingRemovals.clear();
      pendingUnstars.clear();
      refreshDone();
      setSyncError(false);
    } catch (err) {
      setSyncError(true);
      console.warn('进度写回失败', err);
    }
  }
  function scheduleSave(delay = 400) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, delay);
  }
  async function loadProgress() {
    const resp = await fetch(API, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return await resp.json();
  }
  // 旧版把进度存 localStorage：首次对接后端时一次性导入并清掉
  async function importLegacyProgress() {
    let changed = false;
    const legacyDone = JSON.parse(readStorage('heqie-done-v1') || 'null');
    if (isMap(legacyDone) && Object.keys(legacyDone).length) { done = legacyDone; changed = true; }
    const legacyChoices = JSON.parse(readStorage('heqie-choices-v1') || 'null');
    if (isMap(legacyChoices) && Object.keys(legacyChoices).length) { choices = legacyChoices; changed = true; }
    const legacyCurrent = Number(readStorage('heqie-current-v1'));
    if (!Number.isInteger(legacyCurrent) || legacyCurrent < 1 || legacyCurrent > 300) {
      // 更早的版本只记位置不记完成，按「顺序做到第几题」补记（仅第一分区内认这条）
    } else if (legacyCurrent > 1) {
      if (doneCount() === 0 && legacyCurrent <= 31) {
        for (let i = 1; i < legacyCurrent; i++) done[i] = 1;
      }
      current = legacyCurrent; changed = true;
    }
    ['heqie-done-v1', 'heqie-choices-v1', 'heqie-current-v1', 'heqie-migrated-v1'].forEach(dropStorage);
    if (changed) await flushSave();
  }
  const isDone = n => Boolean(done[n]);
  const doneCount = () => Object.keys(done).filter(key => done[key]).length;
  const firstUndone = () => { for (let i = 1; i <= 300; i++) if (!isDone(i)) return i; return 300; };
  // 「最新」＝已做进度前沿：最大已做题号 + 1
  const frontier = () => {
    let max = 0;
    for (const key of Object.keys(done)) if (done[key]) max = Math.max(max, Number(key) || 0);
    return Math.min(max + 1, 300);
  };
  const undoneAfter = from => {
    for (let i = from + 1; i <= 300; i++) if (!isDone(i)) return i;
    for (let i = 1; i <= from; i++) if (!isDone(i)) return i;
    return from;
  };
  const normTile = t => (!t ? '' : (t[0] === '0' ? '5' + t[1] : t));
  const pickedTile = n => {
    const q = data.questions[n - 1], idx = Number(choices[n]);
    if (!q || q.original_only || !Number.isInteger(idx)) return null;
    return [...q.hand, q.draw][idx] || null;
  };
  // '' 未做 / 'done' 已做但判不出（副露题或没记录选择）/ 'right' / 'wrong'
  const verdict = n => {
    if (!isDone(n)) return '';
    const q = data.questions[n - 1], picked = pickedTile(n);
    if (!q || !picked || !q.discard) return 'done';
    return normTile(picked) === normTile(q.discard) ? 'right' : 'wrong';
  };
  function refreshDone() {
    const counter = $('#done-count');
    if (counter) counter.textContent = `已做 ${doneCount()}/300${syncError ? ' · 未保存' : ''}`;
    document.querySelectorAll('#toc a').forEach(a => {
      const m = /^#q(\d{1,3})$/.exec(a.getAttribute('href') || '');
      const v = m ? verdict(Number(m[1])) : '';
      a.classList.toggle('is-done', v !== '');
      a.classList.toggle('is-right', v === 'right');
      a.classList.toggle('is-wrong', v === 'wrong');
      a.classList.toggle('is-starred', Boolean(m && isStarred(Number(m[1]))));
      a.title = v === 'right' ? '做对了' : v === 'wrong' ? '做错了' : v === 'done' ? '已做' : '';
    });
    document.querySelectorAll('#bank-host .bank-item').forEach(item => {
      const badge = item.querySelector('.bank-done');
      if (!badge) return;
      const v = verdict(Number(item.dataset.q));
      badge.hidden = v === '';
      badge.classList.toggle('is-right', v === 'right');
      badge.classList.toggle('is-wrong', v === 'wrong');
      badge.textContent = v === 'right' ? '对' : v === 'wrong' ? '错' : '已做';
    });
    document.querySelectorAll('#bank-host .bank-star').forEach(mark => {
      mark.hidden = !isStarred(Number(mark.closest('.bank-item').dataset.q));
    });
    const starBtn = $('#toggle-star');
    if (starBtn) {
      const on = isStarred(Number(starBtn.dataset.q));
      starBtn.textContent = on ? '★' : '☆';
      starBtn.classList.toggle('is-starred', on);
      starBtn.setAttribute('aria-pressed', String(on));
      starBtn.title = on ? '取消重点标记' : '标记为重点题';
    }
    const toggle = $('#toggle-done');
    if (toggle) {
      const on = isDone(Number(toggle.dataset.q));
      toggle.textContent = on ? '已做 · 点此取消' : '标为已做';
      toggle.classList.toggle('is-done', on);
      toggle.setAttribute('aria-pressed', String(on));
    }
  }
  const isStarred = n => Boolean(stars[n]);
  function setStar(n, on) {
    if (!Number.isInteger(n) || n < 1 || n > 300) return;
    if (on) { stars[n] = 1; pendingUnstars.delete(n); }
    else { delete stars[n]; pendingUnstars.add(n); }
    refreshDone();
    scheduleSave(0);
  }
  function setDone(n, on) {
    if (!Number.isInteger(n) || n < 1 || n > 300) return;
    if (on) { done[n] = 1; pendingRemovals.delete(n); }
    else { delete done[n]; pendingRemovals.add(n); }
    refreshDone();
    scheduleSave(0);   // 选择即写后端并取回合并结果，不用等切题
  }
  function closeMenu() { if (menu.open) menu.close(); }
  function go(n) {
    if (!Number.isInteger(n) || n < 1 || n > 300) return;
    closeMenu();
    if (location.hash === '#q' + pad(n)) return;
    location.hash = 'q' + pad(n);
  }
  const GROUPS = [[1, 90], [91, 180], [181, 240], [241, 300]];
  const groupOf = n => Math.max(0, GROUPS.findIndex(([s, e]) => n >= s && n <= e));
  function buildToc(group) {
    const [start, end] = GROUPS[Number(group)] || GROUPS[0];
    $('#toc').innerHTML = Array.from({length: end - start + 1}, (_, i) => { const n = start+i; return `<a href="#q${pad(n)}" ${n===current?'aria-current="page"':''} ${isDone(n)?'class="is-done"':''}>${pad(n)}</a>`; }).join('');
  }
  function renderAnswer(q, container) {
    const s = pad(q.id);
    setDone(q.id, true);
    container.innerHTML = `<div class="recommend">${tile(q.discard)}<div><small>原书推荐</small><strong>${action(q)}</strong></div><span class="state">${q.action==='kan'?'操作后':'切牌后'}<br>${state(q)}</span></div><div class="translation">${q.translation.map(p=>'<p>'+escape(p)+'</p>').join('')}</div><h2>候选切牌 · 有效牌枚数（原书比较条）</h2>${image('counts'+s+'.webp','候选切牌与有效牌枚数','counts')}<details class="source"><summary>对照日文原解析与补充牌例</summary><div></div></details>`;
    const source = container.querySelector('.source');
    source.addEventListener('toggle', () => { if (source.open && !source.querySelector('img')) source.querySelector('div').innerHTML = image('a'+s+'.webp', '第'+s+'题日文原解析与补充牌例'); });
  }
  function render(n) {
    current = n; const q = data.questions[n-1], s = pad(n);
    document.title = `第${s}题 · 何切300问`;
    $('#current-number').textContent = s;
    $('#previous').disabled = n===1; $('#next').disabled = n===300;
    $('#jump').value = n; $('#jump-error').hidden = true;
    $('#group').value = groupOf(n); buildToc($('#group').value);
    const hand = q.original_only ? image('q'+s+'.webp', '第'+s+'题完整题面，包含副露与摸牌','original-hand') : '<div class="hand" role="group" aria-label="手牌，最右侧为摸牌">'+[...q.hand,q.draw].map((t,i)=>`<button class="tilebtn" type="button" data-index="${i}" aria-pressed="false" aria-label="选择切${name(t)}">${tile(t)}${i===13?'<span class="drawlabel">摸牌</span>':''}</button>`).join('')+'</div>';
    host.innerHTML = `<article class="question" id="q${s}" aria-labelledby="question-title"><h1 id="question-title" class="qheading"><small>第</small>${s}<small>题</small><span class="qmark"><button id="toggle-star" type="button" class="starbtn" data-q="${n}" aria-pressed="false" title="标记为重点题">☆</button><button id="toggle-done" type="button" class="markbtn" data-q="${n}" aria-pressed="false">标为已做</button></span></h1><div class="context"><div>${escape(q.round)} · ${escape(q.seat)} · 第${q.turn}巡${q.special?'<b class="special">'+escape(q.special)+'</b>':''}</div><div class="dora">宝牌指示牌 ${image('dora'+s+'.webp','宝牌指示牌','dora-strip')}</div></div>${hand}<p class="selection" aria-live="polite">${q.original_only?'请选择舍牌，再展开解析。':'点击一枚牌记录选择。'}</p><details class="answer"><summary>展开答案与中文解析</summary><div class="answer-content"></div></details></article>`;
    const buttons = [...host.querySelectorAll('.tilebtn')], selection = host.querySelector('.selection');
    function choose(index, save=false) {
      if (!Number.isInteger(index) || !buttons[index]) return;
      buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
      selection.textContent = '你的选择：切'+name([...q.hand,q.draw][index])+'。'; selection.classList.add('selected');
      if (save) { choices[n]=index; setDone(n,true); }
    }
    buttons.forEach((b,i)=>b.addEventListener('click',()=>choose(i,true))); choose(choices[n]);
    const starToggle = host.querySelector('#toggle-star');
    if (starToggle) starToggle.addEventListener('click', () => setStar(n, !isStarred(n)));
    const doneToggle = host.querySelector('#toggle-done');
    if (doneToggle) doneToggle.addEventListener('click', () => setDone(n, !isDone(n)));
    refreshDone();
    const answer = host.querySelector('.answer');
    answer.addEventListener('toggle', () => { if (answer.open && !answer.querySelector('.recommend')) renderAnswer(q,answer.querySelector('.answer-content')); });
    $('#current-source').innerHTML = '';
    if ($('#current-source-panel').open) renderCurrentSource();
    scheduleSave();
    scrollTo({top:0,behavior:'instant'});
  }
  let bankBuilt = false;
  function bankItem(q) {
    const s = pad(q.id);
    const hand = q.original_only
      ? image('q'+s+'.webp', '第'+s+'题完整题面，包含副露与摸牌', 'bank-scan')
      : '<div class="bank-hand" role="img" aria-label="第'+s+'题手牌，最右为摸牌">'
        + [...q.hand, q.draw].map((t,i)=>`<span class="bt${i===13?' draw':''}"><img src="images/tiles/${t}.png" alt="${name(t)}" loading="lazy" decoding="async" draggable="false"></span>`).join('')
        + '</div>';
    return `<article class="bank-item" id="bank-q${s}" data-q="${q.id}"><h3 class="bank-head"><a href="#q${s}">第 ${s} 题</a><span class="bank-star" hidden title="重点题">★</span><span class="bank-done" hidden>已做</span></h3><p class="bank-context">${escape(q.round)} · ${escape(q.seat)} · 第${q.turn}巡${q.special?' · '+escape(q.special):''}</p>${hand}<details class="answer"><summary>展开答案与中文解析</summary><div class="answer-content"></div></details></article>`;
  }
  function ensureBank() {
    if (bankBuilt) return;
    bankBuilt = true;
    $('#bank-host').innerHTML = '<p class="bank-intro">题库 · 共 300 题，按题号连续排列。点题号进入单题练习；展开答案会自动记为已做，已做过的题在题号旁标出。</p>'
      + data.questions.map(bankItem).join('');
    refreshDone();
  }
  // 题库里图片是懒加载的，行高会随后续加载变化，反复对齐直到目标题位置稳定
  function scrollToBank(n) {
    const target = document.getElementById('bank-q' + pad(n));
    if (!target) { scrollTo({top: 0, behavior: 'instant'}); return; }
    let last = -1, tries = 0;
    const align = () => {
      const top = target.getBoundingClientRect().top + window.scrollY;
      if (Math.abs(top - last) < 2 || tries++ > 90) return;
      last = top;
      scrollTo({top: Math.max(0, top - 78), behavior: 'instant'});
      requestAnimationFrame(align);
    };
    requestAnimationFrame(align);
    [120, 320, 700, 1200].forEach(ms => setTimeout(() => { last = -1; tries = 0; requestAnimationFrame(align); }, ms));
  }
  function showBank() {
    ensureBank();
    document.body.classList.add('bank-mode');
    $('#bank-host').hidden = false;
    host.hidden = true;
    $('#bank').textContent = '返回单题';
    document.title = '题库 · 何切300问';
    scrollToBank(current);
  }
  function hideBank() {
    if (!$('#bank-host').hidden) $('#bank-host').hidden = true;
    if (document.body.classList.contains('bank-mode')) document.body.classList.remove('bank-mode');
    if (host.hidden) host.hidden = false;
    $('#bank').textContent = '题库';
  }
  function route() {
    if (location.hash === '#bank') { showBank(); return; }
    hideBank();
    const match = /^#q(\d{1,3})$/.exec(location.hash);
    let n = match ? Number(match[1]) : firstUndone();
    if (!Number.isInteger(n)||n<1||n>300) n=1;
    const hash='#q'+pad(n); if (location.hash!==hash) history.replaceState(null,'',hash);
    render(n);
  }
  function renderCurrentSource() {
    const q = data.questions[current-1], s = pad(current);
    $('#current-source').innerHTML = `<p class="source-note">第${s}题 · 题面原书p.${pad(q.question_printed)}，解析p.${pad(q.answer_printed)}；PDF第${q.question_pdf}、${q.answer_pdf}页。</p>${image('q'+s+'.webp','第'+s+'题原书完整题面')}<details class="source"><summary>日文原解析与补充牌例</summary><div></div></details>`;
    const details = $('#current-source details');
    details.addEventListener('toggle',()=>{if(details.open&&!details.querySelector('img'))details.querySelector('div').innerHTML=image('a'+s+'.webp','日文原解析与补充牌例');});
  }
  function renderExtra() {
    const item = data.extras[Number($('#extra-select').value)];
    $('#extra-article').innerHTML = `<h3>${escape(item.title)}</h3><p class="source-note">原书p.${pad(item.pdf_page-5)} · PDF第${item.pdf_page}页</p>${item.paragraphs.map(p=>'<p>'+escape(p)+'</p>').join('')}<details class="source"><summary>对照原书与牌形图解</summary><div></div></details>`;
    const details = $('#extra-article details');
    details.addEventListener('toggle',()=>{if(details.open&&!details.querySelector('img'))details.querySelector('div').innerHTML=image('extra'+item.pdf_page+'.webp',item.title);});
  }
  function renderGlossary() {
    const term = $('#glossary-search').value.trim().toLocaleLowerCase();
    const rows = data.glossary.filter(row=>row.join(' ').toLocaleLowerCase().includes(term));
    $('#glossary-body').innerHTML = rows.length ? rows.map(row=>'<tr>'+row.map(t=>'<td>'+escape(t)+'</td>').join('')+'</tr>').join('') : '<tr><td colspan="3">未找到匹配的术语。</td></tr>';
  }
  $('#group').innerHTML = GROUPS.map(([s,e],g)=>`<option value="${g}">${pad(s)}—${pad(e)}题</option>`).join('');
  $('#group').addEventListener('change',()=>buildToc($('#group').value));
  $('#toc').addEventListener('click',e=>{if(e.target.closest('a'))closeMenu();});
  $('#jumpform').addEventListener('submit',e=>{e.preventDefault();const input=$('#jump'),n=Number(input.value);if(!input.value.trim()||!Number.isInteger(n)||n<1||n>300){$('#jump-error').hidden=false;$('#jump-error').textContent='请输入1—300之间的整数题号。';input.focus();return;}$('#jump-error').hidden=true;go(n);});
  $('#previous').addEventListener('click',()=>go(current-1));
  $('#next').addEventListener('click',()=>go(current+1));
  $('#frontier').addEventListener('click',()=>go(frontier()));
  $('#bank').addEventListener('click',()=>{ if (location.hash === '#bank') go(current); else location.hash = 'bank'; });
  $('#menu-toggle').addEventListener('click',()=>{menu.showModal();document.body.classList.add('menu-open');$('#menu-toggle').setAttribute('aria-expanded','true');});
  $('#menu-close').addEventListener('click',closeMenu);
  menu.addEventListener('close',()=>{document.body.classList.remove('menu-open');$('#menu-toggle').setAttribute('aria-expanded','false');$('#menu-toggle').focus({preventScroll:true});});
  menu.addEventListener('click',e=>{if(e.target===menu){const r=menu.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeMenu();}});
  $('#current-source-panel').addEventListener('toggle',()=>{if($('#current-source-panel').open&&!$('#current-source').children.length)renderCurrentSource();});
  $('#extra-select').innerHTML = data.extras.map((x,i)=>`<option value="${i}">${escape(x.title)}</option>`).join('');
  $('#extras-panel').addEventListener('toggle',()=>{if($('#extras-panel').open&&!$('#extra-article').children.length)renderExtra();});
  $('#extra-select').addEventListener('change',renderExtra);
  $('#glossary-panel').addEventListener('toggle',()=>{if($('#glossary-panel').open)renderGlossary();});
  $('#glossary-search').addEventListener('input',renderGlossary);
  $('#glossary-source').addEventListener('toggle',()=>{if($('#glossary-source').open&&!$('#glossary-source img'))$('#glossary-source div').innerHTML=image('extra226.webp','原书术语页一')+image('extra227.webp','原书术语页二');});
  $('#bank-host').addEventListener('toggle', event => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.classList.contains('answer') || !details.open) return;
    const item = details.closest('.bank-item'), content = details.querySelector('.answer-content');
    if (!item || !content || content.querySelector('.recommend')) return;
    renderAnswer(data.questions[Number(item.dataset.q) - 1], content);
  }, true);
  $('#reading-rules').innerHTML = '<p>每页一道题。底栏切换上一题、下一题，或「题库」连续浏览 1—300 题；目录可直接跳到题号，已做过的题号在目录里高亮。切题时答案重新折叠，浏览器后退可回到上一道。键盘左右方向键也可切题。</p><p>打开网页时自动落在第一道未做的题；选牌或展开答案即记为已做，题目下方也可手动标记或取消。做题进度、选牌记录保存在当前浏览器（同一网址下）；不支持本地存储时仍可正常阅读。</p>'+data.reading_rules.map(x=>'<h3>'+escape(x.title)+'</h3><p>'+escape(x.text)+'</p>').join('');
  document.addEventListener('keydown',e=>{if(e.defaultPrevented||menu.open||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.target.closest('input,select,textarea,[contenteditable]'))return;if(e.key==='ArrowLeft'){e.preventDefault();go(current-1);}if(e.key==='ArrowRight'){e.preventDefault();go(current+1);}});
  window.addEventListener('hashchange',route);
  window.addEventListener('pagehide', () => {
    if (!saveTimer) return;
    clearTimeout(saveTimer); saveTimer = null;
    try { navigator.sendBeacon(API, new Blob([JSON.stringify(payload())], { type: 'application/json' })); } catch { /* 关页时丢一次也无妨 */ }
  });
  async function syncFromServer() {
    try {
      const rec = await loadProgress();
      let changed = false;
      const nextDone = isMap(rec.done) ? rec.done : {};
      if (new Set([...Object.keys(nextDone), ...Object.keys(done)]).size !== Object.keys(done).length ||
          Object.keys(nextDone).some(k => !done[k])) changed = true;
      if (changed) { done = nextDone; refreshDone(); }
      if (isMap(rec.choices)) choices = rec.choices;
      if (syncError) setSyncError(false);
    } catch { /* 离线就先本地攒着 */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !saveTimer) syncFromServer();
  });
  window.addEventListener('focus', () => { if (!saveTimer) syncFromServer(); });
  // 先把后端进度取回来，再决定落在哪一题
  async function boot() {
    try {
      const rec = await loadProgress();
      if (isMap(rec.done)) done = rec.done;
      if (isMap(rec.stars)) stars = rec.stars;
      if (isMap(rec.choices)) choices = rec.choices;
      if (Number.isInteger(rec.current) && rec.current >= 1 && rec.current <= 300) current = rec.current;
      await importLegacyProgress();
    } catch (err) {
      setSyncError(true);
      console.warn('读取进度失败：本次不写后端', err);
    }
    route();
  }
  boot();
})();
