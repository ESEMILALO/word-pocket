// Word Pocket: a pocket dictionary for the words you hear in movies,
// series, songs... Look a word up, save it with what you were watching,
// practise it, and send it to Word Log on the computer.
//
// Everything is kept on this phone (localStorage). Meanings come from
// free services that need no account and no key:
//   dictionaryapi.dev  English meanings, pronunciation, audio
//   MyMemory           Spanish translation
//   Datamuse           spelling help: words that start like, or sound like,
//                      what you typed -- for a word you heard but cannot spell
// Only the word you look up is sent to them.
(function(){
  'use strict';

  // --- small helpers -----------------------------------------------------------
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d){ try{ const v = localStorage.getItem('wp_' + k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
    set(k, v){ try{ localStorage.setItem('wp_' + k, JSON.stringify(v)); return true; }catch(e){ return false; } }
  };
  const dayKey = d => new Date(d).toLocaleDateString('en-CA');
  const todayKey = () => dayKey(Date.now());
  const SPEAKER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
  const KINDS = { movie: '🎬', series: '📺', song: '🎵', video: '▶️', podcast: '🎙️', book: '📖', other: '💬' };

  let items = store.get('items', []);
  let settings = Object.assign({ goal: 5, source: null, groupBy: 'source', installHidden: false }, store.get('settings', {}));
  let sources = store.get('sources', []);          // recent [{name, kind}]
  let cache = store.get('cache', {});              // word -> lookup
  let stats = store.get('stats', {});              // id -> {r, w, t}

  const saveItems = () => store.set('items', items);
  const saveSettings = () => store.set('settings', settings);

  function toast(msg, ms){
    const t = $('toast');
    t.innerHTML = msg; t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  function speak(word){
    try{ const u = new SpeechSynthesisUtterance(word); u.lang = 'en-US'; speechSynthesis.cancel(); speechSynthesis.speak(u); }catch(e){}
  }
  function play(data, btn){
    if(btn){ btn.classList.remove('playing'); void btn.offsetWidth; btn.classList.add('playing'); }
    const url = data && data.dict && data.dict.audio;
    if(!url) return speak(data.word);
    try{ new Audio(url).play().catch(() => speak(data.word)); }catch(e){ speak(data.word); }
  }
  function chime(ok){
    try{
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      (ok === false ? [220, 180] : [660, 990]).forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = ok === false ? 'triangle' : 'sine'; o.frequency.value = f;
        const t = ctx.currentTime + i * 0.09;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.3);
      });
      setTimeout(() => ctx.close(), 800);
    }catch(e){}
  }
  const buzz = ms => { try{ navigator.vibrate && navigator.vibrate(ms); }catch(e){} };

  // --- looking words up ---------------------------------------------------------
  async function getJson(url, ms){
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 8000);
    try{
      const r = await fetch(url, { signal: ctl.signal });
      if(r.status === 404) return { notFound: true };
      if(!r.ok) return null;
      return await r.json();
    }catch(e){ return null; }
    finally{ clearTimeout(t); }
  }

  // "meanders" is in the dictionary as "meander"
  function plainForms(word){
    const [head, ...rest] = word.split(' ');
    const tail = rest.length ? ' ' + rest.join(' ') : '';
    const out = [];
    for(const [end, put] of [['ies', 'y'], ['ied', 'y'], ['ing', ''], ['ing', 'e'], ['ed', ''], ['ed', 'e'], ['es', ''], ['s', ''], ['d', '']]){
      if(head.endsWith(end) && head.length > end.length + 2){
        const base = head.slice(0, -end.length) + put;
        out.push(base + tail);
        if(!put && base.length > 2 && base.at(-1) === base.at(-2)) out.push(base.slice(0, -1) + tail);
      }
    }
    return [...new Set(out)];
  }

  // Every shape a saved word can take in a sentence: save, saves, saved, saving.
  function formsOf(word){
    const w = String(word || '').toLowerCase().trim();
    if(!w) return [];
    const [head, ...rest] = w.split(' ');
    const tail = rest.length ? ' ' + rest.join(' ') : '';
    const heads = [head, head + 's', head + 'es', head + 'ed', head + 'd', head + 'ing'];
    if(head.endsWith('e')) heads.push(head.slice(0, -1) + 'ing');
    if(head.endsWith('y')) heads.push(head.slice(0, -1) + 'ies', head.slice(0, -1) + 'ied');
    if(/[^aeiou][aeiou][bdgklmnprt]$/.test(head) && head.length <= 5) heads.push(head + head.at(-1) + 'ed', head + head.at(-1) + 'ing');
    return [...new Set(heads.map(h => h + tail))];
  }

  // a dictionary definition can run to a paragraph: its first sentence is the meaning
  function short(def){
    def = String(def || '');
    if(def.length <= 160) return def;
    const first = def.match(/^.{40,160}?[.;](?=\s|$)/);
    return first ? first[0] : def.slice(0, 150).replace(/\s+\S*$/, '') + '…';
  }

  async function fromDictionary(word){
    if(!/^[a-z][a-z' -]{0,40}$/.test(word)) return { missing: true };
    let offline = false;
    for(const w of [word].concat(plainForms(word))){
      const url = 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(w);
      // the service has short hiccups: one more try before giving up
      let data = await getJson(url);
      if(data === null){ await new Promise(r => setTimeout(r, 700)); data = await getJson(url); }
      if(data === null){ offline = true; break; }
      if(!Array.isArray(data)) continue;
      const out = { phonetic: '', audio: '', senses: [], base: w !== word ? w : '' };
      const perPos = {};
      for(const e of data){
        const ph = e.phonetics || [];
        if(!out.phonetic) out.phonetic = e.phonetic || (ph.find(p => p.text) || {}).text || '';
        if(!out.audio) out.audio = (ph.find(p => p.audio) || {}).audio || '';
        for(const m of e.meanings || []){
          for(const d of m.definitions || []){
            perPos[m.partOfSpeech] = (perPos[m.partOfSpeech] || 0) + 1;
            if(perPos[m.partOfSpeech] > 3 || out.senses.length >= 9) continue;
            out.senses.push({ pos: m.partOfSpeech, def: short(d.definition), ex: (d.example || '').replace(/^["“]+|["”]+$/g, '') });
          }
        }
      }
      return out;
    }
    return offline ? { offline: true } : { missing: true };
  }

  async function toSpanish(text){
    const d = await getJson('https://api.mymemory.translated.net/get?langpair=en|es&q=' + encodeURIComponent(text));
    if(!d || d.notFound) return null;
    const seen = new Set(), out = [];
    const plain = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const add = (t, from) => {
      // translation memories carry junk: other phrases, titles, numbers, stray commas
      if(from != null && String(from).toLowerCase().replace(/[^a-z' -]/g, '').trim() !== text.toLowerCase()) return;
      t = String(t || '').trim().replace(/^[¡¿"'“]+|[,.;:!?"'”]+$/g, '').trim();
      if(!t || /MYMEMORY|QUERY LENGTH|\d|\b[IVX]{2,}\b/i.test(t) || t.length > text.length * 3 + 12) return;
      if(t !== t.toUpperCase()) t = t.charAt(0).toLowerCase() + t.slice(1);
      const k = plain(t);
      if(seen.has(k) || k === plain(text)) return;
      seen.add(k); out.push(t);
    };
    add(d.responseData && d.responseData.translatedText);
    (d.matches || []).filter(m => (m.quality | 0) >= 70).forEach(m => add(m.translation, m.segment || ''));
    return out.slice(0, 3);
  }

  // Spelling help from Datamuse: words that start like it, or sound like it.
  async function spellHelp(text, mode){
    const q = encodeURIComponent(text);
    const url = mode === 'sound' ? 'https://api.datamuse.com/words?sl=' + q + '&md=f&max=20'
              : 'https://api.datamuse.com/sug?s=' + q + '&max=7';
    const d = await getJson(url, 4000);
    if(!Array.isArray(d)) return [];
    // sounds-like brings names and rare words too: keep the common ones
    const freq = x => +(((x.tags || []).find(t => t.startsWith('f:')) || 'f:0').slice(2));
    return d.filter(x => mode !== 'sound' || freq(x) >= 1).map(x => x.word)
      .filter(w => /^[a-z][a-z' -]*$/i.test(w)).slice(0, 8);
  }

  async function lookup(word){
    word = String(word || '').toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 60);
    if(cache[word]) return cache[word];
    const [dict, es] = await Promise.all([fromDictionary(word), toSpanish(word)]);
    const out = { word, dict: dict && !dict.missing && !dict.offline ? dict : null, es: es || [],
                  offline: !!(dict && dict.offline) && es === null,
                  dictFailed: !!(dict && dict.offline) };
    // a half answer is not kept, so the next look-up tries again
    if((out.dict || out.es.length) && !out.dictFailed && es !== null){
      cache[word] = out;
      const keys = Object.keys(cache);
      if(keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete cache[k]);
      store.set('cache', cache);
    }
    return out;
  }

  // --- what you are watching ---------------------------------------------------
  function sourceLabel(s){ return s ? (KINDS[s.kind] || '🎬') + ' ' + s.name : ''; }

  function paintSource(){
    const s = settings.source;
    $('source').classList.toggle('set', !!s);
    $('source').querySelector('.clap').textContent = s ? (KINDS[s.kind] || '🎬') : '🎬';
    $('source-name').textContent = s ? s.name : 'What are you watching?';
  }

  function openSourceSheet(){
    const s = settings.source || { name: '', kind: 'movie' };
    let kind = s.kind || 'movie';
    const sh = $('sheet');
    sh.innerHTML = '<div class="sheet-in"><h2>What are you watching?</h2>'
      + '<input id="src-name" placeholder="Friends, Toy Story, a song…" value="' + esc(s.name) + '" autocomplete="off">'
      + '<div class="kinds">' + Object.keys(KINDS).map(k => '<button class="chip' + (k === kind ? ' on' : '') + '" data-k="' + k + '">'
          + KINDS[k] + ' ' + k + '</button>').join('') + '</div>'
      + (sources.length ? '<div class="recent-src">' + sources.slice(0, 8).map((x, i) => '<button class="sug" data-i="' + i + '">'
          + esc(sourceLabel(x)) + '</button>').join('') + '</div>' : '')
      + '<div class="row-btns"><button class="btn" id="src-ok">Done</button>'
      + (settings.source ? '<button class="ghost" id="src-clear">Nothing now</button>' : '') + '</div></div>';
    sh.hidden = false;
    const name = $('src-name');
    setTimeout(() => name.focus(), 250);
    const done = (picked) => {
      const n = picked ? picked.name : name.value.trim();
      settings.source = n ? { name: n.slice(0, 80), kind: picked ? picked.kind : kind } : null;
      if(settings.source){
        sources = [settings.source].concat(sources.filter(x => x.name.toLowerCase() !== settings.source.name.toLowerCase())).slice(0, 12);
        store.set('sources', sources);
      }
      saveSettings(); paintSource(); sh.hidden = true;
    };
    sh.querySelectorAll('.kinds .chip').forEach(b => b.addEventListener('click', () => {
      kind = b.dataset.k;
      sh.querySelectorAll('.kinds .chip').forEach(x => x.classList.toggle('on', x === b));
    }));
    sh.querySelectorAll('.recent-src .sug').forEach(b => b.addEventListener('click', () => done(sources[+b.dataset.i])));
    $('src-ok').addEventListener('click', () => done());
    name.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); done(); } });
    const clr = $('src-clear');
    if(clr) clr.addEventListener('click', () => { name.value = ''; done(); });
    sh.addEventListener('click', e => { if(e.target === sh) sh.hidden = true; }, { once: true });
  }

  // --- the look-up screen ------------------------------------------------------
  let card = null;   // { data, pos, saved, enter, switched, justSaved, sentence }

  const savedFor = word => {
    const w = word.toLowerCase();
    return items.find(x => x.word.toLowerCase() === w || formsOf(x.word).indexOf(w) !== -1) || null;
  };
  const caughtToday = () => items.filter(x => x.savedAt && dayKey(x.savedAt) === todayKey()).length;

  async function look(word){
    word = String(word || '').trim();
    if(!word) return;
    $('q').value = word;
    $('q').blur();
    $('sugs').innerHTML = '';
    card = { data: null, enter: true };
    paintCard();
    const data = await lookup(word);
    if(!card || card.data !== null) return;
    card = { data, enter: true, saved: savedFor(word), sentence: '' };
    paintCard();
    if(!data.dict && !data.es.length && !data.offline){
      // not found: maybe it is spelt differently from how it sounded
      const [a, b] = await Promise.all([spellHelp(word, 'start'), spellHelp(word, 'sound')]);
      const list = [...new Set(a.concat(b))].filter(w => w.toLowerCase() !== data.word).slice(0, 10);
      if(card && card.data === data){ card.didYouMean = list; paintCard(); }
    }
  }

  function kindsOf(d){ const o = []; (d.senses || []).forEach(s => { if(o.indexOf(s.pos) === -1) o.push(s.pos); }); return o; }

  function paintCard(){
    const box = $('result');
    if(!card){ box.innerHTML = ''; paintRecent(); return; }
    $('recent').innerHTML = '';
    if(!card.data){ box.innerHTML = '<div class="card enter"><div class="loading"><i></i><i></i><i></i></div></div>'; return; }
    const { data } = card, d = data.dict || {};
    const ks = kindsOf(d);
    const pos = ks.indexOf(card.pos) !== -1 ? card.pos : ks[0];
    const senses = (d.senses || []).filter(s => s.pos === pos).slice(0, 3);
    const found = data.dict || data.es.length;
    let body = '';
    if(data.offline){
      body = '<p class="note">You are offline. Save it now: the meaning is added when you are back online.</p>';
    } else if(!found){
      body = '<p class="note">No meaning found for <b>' + esc(data.word) + '</b>.'
        + (card.didYouMean && card.didYouMean.length ? ' Did you mean:' : (card.didYouMean ? ' Check the spelling.' : ' Looking for similar words…')) + '</p>'
        + (card.didYouMean && card.didYouMean.length ? '<div class="sugs">' + card.didYouMean.map(w => '<button class="sug" data-w="' + esc(w) + '">'
          + esc(w) + '</button>').join('') + '</div>' : '');
    } else {
      body = (d.base ? '<div class="c-base">from <b>' + esc(d.base) + '</b></div>' : '')
        + (data.es.length ? '<div class="c-es">' + data.es.map(esc).join(' · ') + '</div>' : '')
        + (ks.length > 1 ? '<div class="chips">' + ks.map(k => '<button class="chip' + (k === pos ? ' on' : '') + '" data-pos="' + esc(k) + '">'
            + esc(k) + '</button>').join('') + '</div>' : '')
        + (senses.length ? '<div class="senses' + (card.enter || card.switched ? ' anim' : '') + '">' + senses.map(s => '<div class="sense">'
            + (ks.length > 1 ? '' : '<span class="tag">' + esc(s.pos) + '</span> ') + esc(s.def)
            + (s.ex ? '<span class="ex">“' + esc(s.ex) + '”</span>' : '') + '</div>').join('') + '</div>' : '')
        + (data.dictFailed ? '<p class="note">The English meanings did not load. <button class="ghost" id="c-retry">Try again</button></p>' : '');
    }
    const canSave = found || data.offline;
    const burst = card.justSaved ? '<span class="plus">+1</span>' + ['#F2C14E', '#6FD08C', '#7FB2FF', '#F2C14E', '#E58AD1', '#6FD08C'].map((c, i) => {
      const a = i / 6 * Math.PI * 2;
      return '<span class="spark" style="background:' + c + ';--x:' + Math.round(Math.cos(a) * 40) + 'px;--y:' + Math.round(Math.sin(a) * 30 - 12) + 'px"></span>';
    }).join('') : '';
    box.innerHTML = '<div class="card' + (card.enter ? ' enter' : '') + '">'
      + '<div class="c-head"><span class="c-word">' + esc(data.word) + '</span>'
        + (d.phonetic ? '<span class="c-pron">' + esc(d.phonetic) + '</span>' : '')
        + '<button class="say" id="c-say" aria-label="Listen">' + SPEAKER + '</button></div>'
      + body
      + (canSave && !card.saved ? '<input class="heard" id="heard" placeholder="What did they say? (optional)" value="' + esc(card.sentence || '') + '">' : '')
      + (card.saved && card.saved.sentence ? '<p class="note">“' + esc(card.saved.sentence) + '”</p>' : '')
      + (canSave ? '<div class="c-btns">'
          + (card.saved ? '<button class="btn saved' + (card.justSaved ? ' just' : '') + '" id="c-unsave">Saved ✓</button>'
                        : '<button class="btn" id="c-save">Save</button>')
          + '<span class="today"><b>' + caughtToday() + '</b> today'
            + (card.saved && card.saved.source ? ' · ' + esc(card.saved.source) : (settings.source && !card.saved ? ' · ' + esc(sourceLabel(settings.source)) : ''))
          + '</span></div>' : '')
      + burst + '</div>';
    card.enter = false; card.switched = false; card.justSaved = false;

    const say = $('c-say');
    if(say) say.addEventListener('click', () => play(data, say));
    box.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { card.pos = b.dataset.pos; card.switched = true; paintCard(); }));
    box.querySelectorAll('.sug').forEach(b => b.addEventListener('click', () => look(b.dataset.w)));
    const retry = $('c-retry');
    if(retry) retry.addEventListener('click', () => { delete cache[data.word]; look(data.word); });
    const heard = $('heard');
    if(heard) heard.addEventListener('input', () => { card.sentence = heard.value; });
    const sv = $('c-save');
    if(sv) sv.addEventListener('click', () => saveCard());
    const un = $('c-unsave');
    if(un) un.addEventListener('click', () => {
      items = items.filter(x => x !== card.saved);
      saveItems(); card.saved = null; paintCard(); paintGoal(); paintCount();
      toast('Removed from your words.');
    });
  }

  function itemFrom(data, sentence){
    const d = data.dict || {};
    const byPos = {};
    (d.senses || []).forEach(s => { if(!byPos[s.pos]) byPos[s.pos] = s.def.replace(/[.;]\s*$/, ''); });
    return {
      id: 'wp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      word: d.base || data.word,
      es: data.es.join(', '),
      meaning: Object.keys(byPos).slice(0, 3).map(p => p + ': ' + byPos[p]).join('; '),
      pron: d.phonetic || '',
      sentence: (sentence || '').trim().slice(0, 300),
      source: sourceLabel(settings.source),
      savedAt: new Date().toISOString(),
      sent: false,
      pending: !!data.offline
    };
  }

  function saveCard(){
    if(!card || !card.data) return;
    const it = itemFrom(card.data, card.sentence);
    items = [it].concat(items.filter(x => x.word.toLowerCase() !== it.word.toLowerCase()));
    if(!saveItems()){ toast('Could not save: this phone has no space left for the app.'); return; }
    card.saved = it; card.justSaved = true;
    chime(); buzz(25);
    paintCard(); paintGoal(); paintCount();
    if(caughtToday() === (+settings.goal || 5)) setTimeout(() => toast('🎉 Today’s goal reached!'), 500);
  }

  function paintRecent(){
    const last = items.slice(0, 8);
    $('recent').innerHTML = last.length
      ? '<div class="recent-h">Recently saved</div><div class="recent">' + last.map(x => '<button data-w="' + esc(x.word) + '">' + esc(x.word)
          + (x.es ? '<small>' + esc(x.es.split(',')[0]) + '</small>' : '') + '</button>').join('') + '</div>'
      : '<div class="empty"><b>Heard a word you don’t know?</b><br>Type it above, or tap the microphone and say it.'
        + '<br><br>Tap 🎬 first to note what you are watching.</div>';
    $('recent').querySelectorAll('button').forEach(b => b.addEventListener('click', () => look(b.dataset.w)));
  }

  // spelling suggestions while typing
  let sugTimer = null, sugFor = '';
  $('q').addEventListener('input', () => {
    const v = $('q').value.trim();
    clearTimeout(sugTimer);
    if(v.length < 2){ $('sugs').innerHTML = ''; return; }
    sugTimer = setTimeout(async () => {
      sugFor = v;
      const list = await spellHelp(v, 'start');
      if(sugFor !== v || $('q').value.trim() !== v) return;
      $('sugs').innerHTML = list.filter(w => w.toLowerCase() !== v.toLowerCase()).slice(0, 6)
        .map(w => '<button class="sug" data-w="' + esc(w) + '">' + esc(w) + '</button>').join('');
      $('sugs').querySelectorAll('.sug').forEach(b => b.addEventListener('click', () => look(b.dataset.w)));
    }, 250);
  });
  $('look').addEventListener('submit', e => { e.preventDefault(); look($('q').value); });
  $('source').addEventListener('click', openSourceSheet);

  // say the word instead of typing it
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(Rec){
    $('mic').hidden = false;
    let rec = null;
    $('mic').addEventListener('click', () => {
      if(rec){ rec.stop(); return; }
      rec = new Rec();
      rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 5;
      $('mic').classList.add('on');
      rec.onresult = e => {
        const alts = [...e.results[0]].map(a => a.transcript.trim().toLowerCase()).filter(Boolean);
        const uniq = [...new Set(alts)];
        if(!uniq.length) return;
        look(uniq[0]);
        if(uniq.length > 1){
          setTimeout(() => {
            $('sugs').innerHTML = '<span class="sug-label">Or did you say:</span>' + uniq.slice(1, 5)
              .map(w => '<button class="sug" data-w="' + esc(w) + '">' + esc(w) + '</button>').join('');
            $('sugs').querySelectorAll('.sug').forEach(b => b.addEventListener('click', () => look(b.dataset.w)));
          }, 50);
        }
      };
      rec.onerror = ev => { if(ev.error === 'not-allowed') toast('Allow the microphone to say words.'); };
      rec.onend = () => { $('mic').classList.remove('on'); rec = null; };
      try{ rec.start(); }catch(e){ $('mic').classList.remove('on'); rec = null; }
    });
  }

  // --- my words ------------------------------------------------------------------
  function paintCount(){ $('count').textContent = items.length ? String(items.length) : ''; }

  function paintGoal(){
    const n = caughtToday(), goal = +settings.goal || 5;
    $('goal-num').textContent = n;
    $('ring').style.strokeDashoffset = String(94.25 * (1 - Math.min(1, n / goal)));
    $('goal').classList.toggle('done', n >= goal);
  }
  $('goal').addEventListener('click', () => {
    const n = caughtToday(), goal = +settings.goal || 5;
    toast(n >= goal ? '🎉 ' + n + ' words today. Goal reached!' : '<b>' + n + ' of ' + goal + '</b> words today. ' + (goal - n) + ' to go!');
  });

  function paintSendBox(){
    const unsent = items.filter(x => !x.sent).length;
    const box = $('send-box');
    box.classList.toggle('quiet', !unsent);
    box.innerHTML = unsent
      ? '<p><b>' + unsent + ' new word' + (unsent === 1 ? '' : 's') + ' for Word Log</b>Send them to your computer through OneDrive.</p>'
        + '<button class="btn" id="send">Send</button>'
      : '<p><b>' + (items.length ? 'Everything is in Word Log ✓' : 'No words yet') + '</b>'
        + (items.length ? 'New words you save will wait here.' : 'Look a word up and save it.') + '</p>';
    const b = $('send');
    if(b) b.addEventListener('click', () => sendToWordLog(items.filter(x => !x.sent)));
  }

  function paintList(){
    paintSendBox();
    const q = $('filter').value.trim().toLowerCase();
    const shown = items.filter(x => !q || [x.word, x.es, x.meaning, x.sentence, x.source].join(' ').toLowerCase().includes(q));
    if(!shown.length){
      $('list').innerHTML = '<div class="empty">' + (items.length ? 'Nothing matches.' : 'Your saved words will be here.') + '</div>';
      return;
    }
    const groups = new Map();
    shown.forEach(x => {
      const k = settings.groupBy === 'day' ? dayKey(x.savedAt) : (x.source || 'Other words');
      if(!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    });
    const label = k => {
      if(settings.groupBy !== 'day') return esc(k);
      if(k === todayKey()) return 'Today';
      const y = new Date(); y.setDate(y.getDate() - 1);
      if(k === dayKey(y)) return 'Yesterday';
      return new Date(k + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    };
    let n = 0;
    $('list').innerHTML = [...groups].map(([k, list]) => '<div class="group-h">' + label(k) + ' <span>' + list.length + '</span></div>'
      + list.map(x => '<div class="row" data-id="' + esc(x.id) + '" style="animation-delay:' + Math.min(n++, 12) * 25 + 'ms">'
        + '<div class="row-top"><span class="w">' + esc(x.word) + '</span><span class="es">' + esc(x.es || '') + '</span>'
          + (x.pending ? '<span class="tag wait">no meaning yet</span>' : x.sent ? '<span class="tag sent">in Word Log</span>' : '')
          + '<button class="say" data-w="' + esc(x.word) + '" aria-label="Listen">' + SPEAKER + '</button></div>'
        + '<div class="row-more">' + (x.meaning ? esc(x.meaning) : '')
          + (x.sentence ? '<div class="sent">“' + esc(x.sentence) + '”</div>' : '')
          + '<div class="hint">' + esc(x.source || '') + (x.source ? ' · ' : '') + new Date(x.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + '</div>'
          + '<button class="ghost" data-look="' + esc(x.word) + '" style="margin-top:10px">See the meanings</button> '
          + '<button class="del" data-del="' + esc(x.id) + '">Delete</button></div></div>').join('')).join('');
    $('list').querySelectorAll('.row-top').forEach(r => r.addEventListener('click', e => {
      if(e.target.closest('.say')) return;
      r.parentElement.classList.toggle('open');
    }));
    $('list').querySelectorAll('.say').forEach(b => b.addEventListener('click', () => speak(b.dataset.w)));
    $('list').querySelectorAll('[data-look]').forEach(b => b.addEventListener('click', () => { show('look'); look(b.dataset.look); }));
    $('list').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const row = b.closest('.row');
      row.classList.add('out');
      setTimeout(() => {
        items = items.filter(x => x.id !== b.dataset.del);
        saveItems(); paintList(); paintGoal(); paintCount();
      }, 250);
    }));
  }
  $('filter').addEventListener('input', paintList);
  document.querySelectorAll('.groupby button').forEach(b => b.addEventListener('click', () => {
    settings.groupBy = b.dataset.g; saveSettings();
    document.querySelectorAll('.groupby button').forEach(x => x.classList.toggle('on', x === b));
    paintList();
  }));

  // Word Log reads the file from the "Word Pocket" folder in OneDrive and
  // lists the words under Dictionary -> Saved while reading. A .txt file,
  // because phones only share a few kinds of file.
  async function sendToWordLog(list){
    if(!list.length){ toast('Nothing new to send.'); return; }
    const stamp = new Date();
    const name = 'word-pocket-' + stamp.toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.txt';
    const body = JSON.stringify({ app: 'word-pocket', sentAt: stamp.toISOString(),
      items: list.map(x => ({ id: x.id, word: x.word, es: x.es, meaning: x.meaning, pron: x.pron,
        sentence: x.sentence, title: x.source ? 'Heard in ' + x.source.replace(/^\S+\s/, '') : 'Word Pocket', savedAt: x.savedAt })) }, null, 1);
    const file = new File([body], name, { type: 'text/plain' });
    const markSent = () => {
      const ids = new Set(list.map(x => x.id));
      items.forEach(x => { if(ids.has(x.id)) x.sent = true; });
      saveItems(); paintList();
    };
    if(navigator.canShare && navigator.canShare({ files: [file] })){
      try{
        await navigator.share({ files: [file], title: 'Word Pocket words' });
        markSent();
        toast('Sent ' + list.length + ' word' + (list.length === 1 ? '' : 's') + '. Word Log picks them up next time it opens.', 4000);
      }catch(e){
        if(e && e.name !== 'AbortError') toast('Could not share the file.');
      }
      return;
    }
    // no share sheet (a computer browser): download the file instead
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    markSent();
    toast('Downloaded ' + name + '. Put it in OneDrive → Word Pocket.', 5000);
  }
  $('resend').addEventListener('click', () => sendToWordLog(items));

  $('set-goal').value = String(settings.goal);
  $('set-goal').addEventListener('change', () => { settings.goal = +$('set-goal').value; saveSettings(); paintGoal(); });

  // Words saved offline get their meaning when the phone is back online.
  async function fillPending(){
    const waiting = items.filter(x => x.pending);
    for(const x of waiting){
      const data = await lookup(x.word);
      if(data.offline) return;
      const fresh = itemFrom(data, x.sentence);
      Object.assign(x, { es: fresh.es, meaning: fresh.meaning, pron: fresh.pron, word: fresh.word, pending: false });
      saveItems();
    }
    if(waiting.length) paintList();
  }
  window.addEventListener('online', fillPending);

  // --- practice -----------------------------------------------------------------
  // Eight quick questions with your own words, turn by turn: the word to its
  // Spanish, the Spanish to the word, and the word back in the line you heard.
  let game = null;
  const shuffle = a => { a = a.slice(); for(let i = a.length - 1; i > 0; i--){ const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const firstEs = x => String(x.es || '').split(',')[0].trim();

  function gapOf(x){
    if(!x.sentence) return null;
    const forms = formsOf(x.word).sort((a, b) => b.length - a.length).map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const m = x.sentence.match(new RegExp('(?<![\\p{L}])(' + forms.join('|') + ')(?![\\p{L}])', 'iu'));
    return m ? { before: x.sentence.slice(0, m.index), after: x.sentence.slice(m.index + m[0].length) } : null;
  }

  function startGame(){
    const pool = items.filter(x => x.word && firstEs(x));
    if(pool.length < 4){
      $('game').innerHTML = '<div class="empty"><b>Save at least 4 words to play.</b><br>You have ' + pool.length
        + ' so far. Save the words you hear, then come back.</div>';
      return;
    }
    // the words you miss most, and the ones not practised yet, come first
    const weight = x => { const s = stats[x.id] || {}; return (s.w || 0) - (s.r || 0) * 0.7 - (s.t ? 0 : 1) + Math.random() * 0.8; };
    const chosen = pool.slice().sort((a, b) => weight(b) - weight(a)).slice(0, 8);
    const qs = shuffle(chosen).map((x, i) => {
      let kind = ['es', 'en', 'gap'][i % 3];
      const gap = kind === 'gap' ? gapOf(x) : null;
      if(kind === 'gap' && !gap) kind = i % 2 ? 'en' : 'es';
      const answer = kind === 'es' ? firstEs(x) : x.word;
      const opts = [answer];
      for(const o of shuffle(pool.filter(o => o.id !== x.id))){
        const v = kind === 'es' ? firstEs(o) : o.word;
        if(opts.length < 4 && v && opts.every(p => p.toLowerCase() !== v.toLowerCase())) opts.push(v);
      }
      return { x, kind, gap, answer, opts: shuffle(opts) };
    });
    game = { qs, i: 0, right: 0, combo: 0, best: 0, missed: [], locked: false };
    paintQuestion();
  }

  function paintQuestion(){
    const g = game, q = g.qs[g.i];
    const ask = { es: 'What does it mean?', en: 'Which word is it?', gap: 'Which word completes it?' }[q.kind];
    const prompt = q.kind === 'es' ? '<div class="g-q">' + esc(q.x.word) + '</div>'
      : q.kind === 'en' ? '<div class="g-q es">' + esc(firstEs(q.x)) + '</div>'
      : '<div class="g-sent">' + esc(q.gap.before) + '<u></u>' + esc(q.gap.after) + '</div>';
    $('game').innerHTML = '<div class="g-top"><div class="g-bar"><i style="width:' + (g.i / g.qs.length * 100) + '%"></i></div>'
        + '<span class="g-combo" id="combo">' + (g.combo >= 2 ? '🔥 ' + g.combo : '') + '</span></div>'
      + '<div class="g-card"><div class="g-ask">' + ask + '</div>' + prompt
        + (q.x.source ? '<div class="g-src">' + esc(q.x.source) + '</div>' : '')
        + '<div class="g-opts">' + q.opts.map((o, k) => '<button class="g-opt" data-k="' + k + '">' + esc(o) + '</button>').join('') + '</div></div>';
    g.locked = false;
    if(q.kind === 'es') speak(q.x.word);
    $('game').querySelectorAll('.g-opt').forEach(b => b.addEventListener('click', () => answer(+b.dataset.k)));
  }

  function answer(k){
    const g = game;
    if(!g || g.locked) return;
    g.locked = true;
    const q = g.qs[g.i], ok = q.opts[k] === q.answer;
    const btns = $('game').querySelectorAll('.g-opt');
    btns.forEach((b, j) => { b.disabled = true; if(q.opts[j] === q.answer) b.classList.add('right'); });
    if(!ok){ btns[k].classList.add('wrong'); buzz([40, 60, 40]); }
    chime(ok);
    const s = stats[q.x.id] = stats[q.x.id] || {};
    if(ok){ g.right++; g.combo++; g.best = Math.max(g.best, g.combo); s.r = (s.r || 0) + 1; }
    else{ g.combo = 0; g.missed.push(q.x); s.w = (s.w || 0) + 1; }
    s.t = Date.now();
    store.set('stats', stats);
    const c = $('combo');
    c.textContent = g.combo >= 2 ? '🔥 ' + g.combo : '';
    if(g.combo >= 2){ c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
    if(q.kind !== 'es') speak(q.x.word);
    setTimeout(() => {
      if(game !== g) return;
      g.i++;
      if(g.i < g.qs.length) paintQuestion(); else paintEnd();
    }, ok ? 900 : 1700);
  }

  function paintEnd(){
    const g = game, n = g.qs.length, pct = g.right / n;
    const stars = pct >= 0.9 ? 3 : pct >= 0.6 ? 2 : 1;
    $('game').innerHTML = '<div class="g-end">'
      + '<div class="g-score' + (pct >= 0.9 ? ' great' : '') + '">' + g.right + '/' + n + '</div>'
      + '<div class="g-stars">' + [1, 2, 3].map(i => '<span style="color:' + (i <= stars ? '#F2C14E' : '#333A46') + '">★</span>').join('') + '</div>'
      + '<div class="g-ask">' + (pct === 1 ? 'Perfect round!' : pct >= 0.6 ? 'Nice work' : 'Keep going, they will stick')
        + (g.best >= 3 ? ' · best run ' + g.best : '') + '</div>'
      + (g.missed.length ? '<div class="g-miss"><div class="g-ask" style="margin-bottom:6px">To look at again</div>'
          + g.missed.map(x => '<div><b>' + esc(x.word) + '</b> — <span>' + esc(x.es) + '</span></div>').join('') + '</div>' : '')
      + '<div class="g-btns"><button class="btn" id="g-again">Play again</button><button class="ghost" id="g-words">My words</button></div></div>';
    $('g-again').addEventListener('click', startGame);
    $('g-words').addEventListener('click', () => show('words'));
    game = null;
  }

  // --- tabs and start -------------------------------------------------------------
  function show(view){
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    ['look', 'words', 'practice'].forEach(v => { $('view-' + v).hidden = v !== view; });
    if(view === 'words') paintList();
    if(view === 'practice') startGame();
    if(view !== 'practice') game = null;
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  document.querySelectorAll('.groupby button').forEach(b => b.classList.toggle('on', b.dataset.g === settings.groupBy));

  paintSource(); paintGoal(); paintCount(); paintRecent();
  if(navigator.onLine) fillPending();

  // works offline once it has been opened
  if('serviceWorker' in navigator && location.protocol === 'https:'){
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // keep the words even if the phone runs short of space
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
