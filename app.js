// © 2026 Eduardo Cruz. PolyForm Noncommercial License 1.0.0 (see LICENSE.md):
// free for non-commercial use, not for sale. All other rights reserved.
//
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
  let cache = store.get('cache2', {});             // word -> lookup (cache2: answers from several dictionaries)
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
    if(settings.sound === false) return;
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
  const buzz = ms => { if(settings.vibrate === false) return; try{ navigator.vibrate && navigator.vibrate(ms); }catch(e){} };

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

  // --- several dictionaries, one clear answer -----------------------------------
  // Each source does what it does best:
  //   Datamuse       short definitions with their labels (dated, finance, slang),
  //                  the kinds of word in order of use, how common the word is
  //   Wiktionary     an example for each meaning, and the Spanish for each
  //                  meaning -- and how many languages translate a meaning,
  //                  which is the best sign of how much it is used
  //   dictionaryapi  the pronunciation and a recording; meanings when the
  //                  others have none
  //   MyMemory       the Spanish, only when Wiktionary has none
  // Old, rare and dialect meanings are left out; specialist ones go last.
  const POS_NAME = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' };
  const DROP = /\b(obsolete|archaic|dated|rare|historical|dialect(al)?|nonstandard|poetic|obsolescent|uncommon|eye dialect|misspelling|proscribed|humorous)\b/i;
  const SHOW = /^(informal|colloquial|slang|vulgar|offensive|derogatory|formal|literary|US|UK|British|American|figuratively|idiomatic)$/i;
  const SKIP = /^(transitive|intransitive|ambitransitive|countable|uncountable|reflexive|ergative|usually|often|with|of |in |by |plural|singular|attributive|predicative|manner|degree|now|especially|chiefly|also|sometimes|followed|not comparable|comparable|copulative|auxiliary|modal|impersonal|stative|Ireland|Scotland|Commonwealth|Australia|New Zealand|Canada|India|South Africa|Northern England|Caribbean|Philippines|Singapore|Hong Kong|euphemistic)/i;
  const NAMES = /^(an? |the )?(surname|(male|female|unisex) given name|placename|place name|(small )?(river|town|city|village|county|commune|municipality|island|lake|mountain|community|census-designated place|hamlet|suburb|neighbourhood|district|region|state|province|ghost town|unincorporated community)\b)/i;
  const JUNK = /^(alternative (form|spelling|case form) of|synonym of|obsolete (form|spelling) of|(nonstandard|archaic|dated) (form|spelling) of|plural of|simple past|past participle|present participle|third-person|used other than|misspelling of|abbreviation of|initialism of|acronym of|clipping of|contraction of|ellipsis of|eye dialect|en dash|$)/i;

  const clean = html => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);

  // "adj\t(dated, finance) Text." -> { pos, def, tags, special }
  function senseFrom(raw){
    const tab = raw.indexOf('\t');
    const pos = POS_NAME[raw.slice(0, tab)] || raw.slice(0, tab);
    let text = raw.slice(tab + 1).trim();
    const labels = [];
    let m;
    while((m = text.match(/^\(([^()]*)\)\s*/))){
      m[1].split(/,\s*|\s+or\s+|\s+and\s+/).map(s => s.trim()).filter(Boolean).forEach(l => labels.push(l));
      text = text.slice(m[0].length);
    }
    if(JUNK.test(text) || NAMES.test(text) || DROP.test(labels.join(', ')) || /^\(?(now )?(rare|archaic|obsolete)\b/i.test(text)) return null;
    const shown = labels.filter(l => SHOW.test(l)).map(l => l.toLowerCase().replace('figuratively', 'figurative'));
    const domains = labels.filter(l => !SHOW.test(l) && !SKIP.test(l) && l.length < 26);
    return { pos, def: short(text.replace(/\s+$/, '')), raw: text, tags: domains.concat(shown).slice(0, 2), special: domains.length > 0 };
  }

  async function fromDatamuse(word){
    const d = await getJson('https://api.datamuse.com/words?sp=' + encodeURIComponent(word) + '&md=dpfr&ipa=1&max=1', 6000);
    if(d === null) return null;
    const x = Array.isArray(d) && d[0] && d[0].word.toLowerCase() === word ? d[0] : null;
    if(!x) return { senses: [], posOrder: [], freq: 0 };
    const tags = x.tags || [];
    const tag = p => (tags.find(t => t.startsWith(p)) || '').slice(p.length);
    return {
      senses: (x.defs || []).map(senseFrom).filter(Boolean),
      posOrder: tags.filter(t => POS_NAME[t]).map(t => POS_NAME[t]),
      freq: +tag('f:') || 0,
      ipa: tag('ipa_pron:') ? '/' + tag('ipa_pron:') + '/' : '',
      base: x.defHeadword || ''
    };
  }

  // Wiktionary's definitions page: an example for each meaning (and the
  // meanings themselves, when Datamuse has none)
  async function fromWiktionary(title){
    const d = await getJson('https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(title.replace(/ /g, '_')), 7000);
    if(!d || !Array.isArray(d.en)) return { examples: {}, senses: [] };
    const examples = {}, senses = [];
    d.en.forEach(e => (e.definitions || []).forEach(x => {
      const def = clean(x.definition);
      if(!def || JUNK.test(def) || NAMES.test(def)) return;
      const ex = (x.examples || []).map(clean).find(t => t && t.length < 170);
      if(ex) examples[norm(def)] = ex;
      senses.push({ pos: String(e.partOfSpeech || '').toLowerCase(), def: short(def), raw: def, tags: [], special: false });
    }));
    return { examples, senses };
  }

  // Wiktionary's translation tables: for each meaning of the word, how many
  // languages translate it, and its Spanish.
  async function wikitext(title){
    const d = await getJson('https://en.wiktionary.org/w/api.php?action=parse&format=json&origin=*&prop=wikitext&redirects=1&page='
      + encodeURIComponent(title), 7000);
    return d && d.parse && d.parse.wikitext ? d.parse.wikitext['*'] : '';
  }
  function englishPart(t){
    const i = t.search(/^==English==\s*$/m);
    if(i < 0) return t;
    const rest = t.slice(i + 11), j = rest.search(/^==[^=]/m);
    return j < 0 ? rest : rest.slice(0, j);
  }
  function tablesIn(text){
    const out = [];
    let pos = '', cur = null;
    englishPart(text).split('\n').forEach(line => {
      const h = line.match(/^===+\s*([A-Za-z ]+?)\s*===+\s*$/);
      if(h && /^(noun|verb|adjective|adverb|phrasal verb|phrase|idiom|interjection|preposition|pronoun|conjunction)$/i.test(h[1])) pos = h[1].toLowerCase();
      const top = line.match(/^\{\{trans-top(?:-also)?\|(.*)\}\}\s*$/);
      if(top){
        const gloss = top[1].split('|').filter(p => !/^[a-z]+=/.test(p)).join(' ');
        cur = { pos, gloss, size: 0, es: [] };
        return;
      }
      if(!cur) return;
      if(/^\{\{trans-bottom\}\}/.test(line)){ out.push(cur); cur = null; return; }
      if(/^\*[^:*]/.test(line)) cur.size++;
      if(/^\*:?\s*Spanish:/.test(line) || (cur.inEs && /^\*:/.test(line))){
        cur.inEs = /^\*\s*Spanish:/.test(line) || cur.inEs;
        let m;
        const re = /\{\{tt?\+?\|es\|([^|}]+)/g;
        while((m = re.exec(line))) if(cur.es.indexOf(m[1]) === -1) cur.es.push(m[1]);
      } else if(/^\*[^:]/.test(line)) cur.inEs = false;
    });
    return out;
  }
  // the word as it is listed: "meanders" -> "meander", "ran" -> "run"
  function baseIn(text){
    const t = englishPart(text);
    if(/\{\{(trans-top|see translation subpage|trans-see)/.test(t)) return '';
    const defs = t.split(/\n/).filter(l => /^#\s/.test(l));
    if(!defs.length || !defs.every(l => /\{\{[a-z -]*\bof\||\{\{en-[a-z -]+\|/i.test(l))) return '';
    const m = t.match(/\{\{(?:[a-z -]*\bof|en-(?:third-person singular|past|simple past|present participle|plural noun)[a-z -]*)\|(?:en\|)?([^|}]+)/i);
    return m ? m[1].trim() : '';
  }
  async function translationTables(title, text){
    let tables = tablesIn(text);
    // very common words keep their translations on a page of their own
    if(/\{\{(see translation subpage|trans-see)/.test(text)) tables = tables.concat(tablesIn(await wikitext(title + '/translations')));
    return tables;
  }

  const STOP = new Set('the and for with that this which who from into something someone one its their his her used especially other than more most such being have has are was were not any some way kind'.split(' '));
  const toks = s => (String(s).toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/(ing|ed|es|s|ly)$/, ''));
  function closeness(def, gloss){
    const A = new Set(toks(def)), B = toks(gloss);
    if(!B.length) return 0;
    let n = 0;
    B.forEach(w => { if(A.has(w)) n++; });
    return n / Math.min(B.length, 4);
  }

  // The meanings of one kind of word, the most used first: an everyday
  // meaning before a specialist one, then meanings translated into many
  // languages before the rest, then the dictionary's own order.
  function rank(senses, tables, examples){
    const used = new Set();
    senses.forEach((s, i) => {
      s.i = i;
      s.ex = s.ex || examples[norm(s.raw)] || '';
      let best = null, score = 0;
      tables.forEach((t, k) => {
        if(t.pos && s.pos && t.pos !== s.pos && !(t.pos === 'phrasal verb' && s.pos === 'verb')) return;
        const c = closeness(s.raw, t.gloss) - (used.has(k) ? 0.3 : 0);
        if(c > score){ score = c; best = k; }
      });
      if(best !== null && score >= 0.5){ used.add(best); s.es = tables[best].es.slice(0, 2); s.size = tables[best].size; }
      else { s.es = []; s.size = 0; }
    });
    const sz = s => s.size >= 8 ? s.size : 0;
    return senses.slice().sort((a, b) => (a.special - b.special) || (sz(b) - sz(a)) || (a.i - b.i));
  }

  const COMMON = f => f >= 100 ? 'very common' : f >= 10 ? 'common' : f >= 1 ? 'less common' : f > 0 ? 'rare' : '';

  async function lookup(word){
    word = String(word || '').toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 60);
    if(cache[word]) return cache[word];
    const [dm, da, text0] = await Promise.all([fromDatamuse(word), fromDictionary(word), wikitext(word)]);
    if(dm === null && da && da.offline) return { word, dict: null, es: [], offline: true };
    // the word as listed, for the pages that only describe that one
    const base = (dm && dm.base) || baseIn(text0) || (dm && dm.senses.length ? '' : (da && da.base)) || '';
    const title = base && base !== word ? base : word;
    const [wk, text] = await Promise.all([fromWiktionary(title), title === word ? text0 : wikitext(title)]);
    const tables = await translationTables(title, text);

    // the meanings: Datamuse's labelled ones, else Wiktionary's, else dictionaryapi's
    let senses = dm && dm.senses.length ? dm.senses
      : wk.senses.length ? wk.senses
      : (da && da.senses ? da.senses.map(s => ({ pos: s.pos, def: s.def, raw: s.def, ex: s.ex, tags: [], special: false })) : []);
    const order = (dm && dm.posOrder.length ? dm.posOrder : []).concat(senses.map(s => s.pos)).filter((p, i, a) => a.indexOf(p) === i);
    const byPos = order.map(p => ({ pos: p, senses: rank(senses.filter(s => s.pos === p), tables, wk.examples) })).filter(g => g.senses.length);
    // "fast" is listed adverb first, but its adjective is far more translated
    const top = g => Math.max(0, ...g.senses.map(s => s.size || 0));
    const lead = byPos.slice(1).reduce((b, g) => top(g) > top(b) ? g : b, byPos[0]);
    if(lead && lead !== byPos[0] && top(lead) >= 1.5 * Math.max(top(byPos[0]), 1)){ byPos.splice(byPos.indexOf(lead), 1); byPos.unshift(lead); }
    senses = [].concat(...byPos.map(g => g.senses));

    // the Spanish: of the most used meaning, else the biggest table, else MyMemory
    let es = (byPos[0] && byPos[0].senses.find(s => s.es.length) || {}).es || [];
    if(!es.length){ const big = tables.filter(t => t.es.length).sort((a, b) => b.size - a.size)[0]; if(big) es = big.es.slice(0, 3); }
    let esFailed = false;
    if(!es.length){ const mm = await toSpanish(title); if(mm === null) esFailed = true; else es = mm; }

    const dict = senses.length ? {
      senses: senses.map(s => ({ pos: s.pos, def: s.def, ex: (s.ex || '').replace(/^["“]+|["”]+$/g, ''), es: s.es || [], tags: s.tags || [] })),
      phonetic: (da && da.phonetic) || (dm && dm.ipa) || '',
      audio: (da && da.audio) || '',
      base: title !== word ? title : '',
      common: COMMON(dm ? dm.freq : 0)
    } : null;
    const out = { word, dict, es, offline: false, dictFailed: !dict && (dm === null || !!(da && da.offline)) };
    if((dict || es.length) && !esFailed && dm !== null){
      cache[word] = out;
      const keys = Object.keys(cache);
      if(keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete cache[k]);
      store.set('cache2', cache);
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
    const all = (d.senses || []).filter(s => s.pos === pos);
    const senses = all.slice(0, card.more ? 6 : 3);
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
        + (senses.length ? '<div class="senses' + (card.enter || card.switched ? ' anim' : '') + '">' + senses.map((s, n) => '<div class="sense">'
            + '<span class="s-n">' + (n + 1) + '</span><div class="s-body">'
            + (ks.length > 1 ? '' : '<span class="tag">' + esc(s.pos) + '</span> ')
            + (s.tags || []).map(t => '<span class="tag lbl">' + esc(t) + '</span> ').join('') + esc(s.def)
            + (s.es && s.es.length ? '<span class="s-es">→ ' + s.es.map(esc).join(', ') + '</span>' : '')
            + (s.ex ? '<span class="ex">“' + esc(s.ex) + '”</span>' : '') + '</div></div>').join('') + '</div>'
            + (all.length > 3 ? '<button class="more" id="c-more">' + (card.more ? 'Fewer meanings' : 'More meanings (' + (Math.min(all.length, 6) - 3) + ')') + '</button>' : '') : '')
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
        + '<button class="say" id="c-say" aria-label="Listen">' + SPEAKER + '</button>'
        + (d.common ? '<span class="common c-' + d.common.replace(' ', '-') + '">' + d.common + '</span>' : '') + '</div>'
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
    box.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { card.pos = b.dataset.pos; card.more = false; card.switched = true; paintCard(); }));
    const more = $('c-more');
    if(more) more.addEventListener('click', () => { card.more = !card.more; card.switched = card.more; paintCard(); });
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
      saveItems(); card.saved = null; paintCard(); paintGoal(); paintCount(); paintDue();
      toast('Removed from your words.');
    });
  }

  function itemFrom(data, sentence){
    const d = data.dict || {};
    const byPos = {};
    (d.senses || []).forEach(s => { if(!byPos[s.pos]) byPos[s.pos] = s.def.replace(/[.;]\s*$/, '') + (s.es && s.es.length ? ' (' + s.es[0] + ')' : ''); });
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
    paintCard(); paintGoal(); paintCount(); markActive(); paintDue();
    if(caughtToday() === (+settings.goal || 5)) setTimeout(() => { confetti(); toast('🎉 Today’s goal reached!'); }, 400);
  }

  function todayCard(){
    if(!items.length) return '';
    const n = caughtToday(), goal = +settings.goal || 5, st = streak(), due = dueWords().length;
    return '<div class="today-card">'
      + '<div class="tc"><span>🔥</span><b>' + st + '</b><small>day' + (st === 1 ? '' : 's') + ' streak</small></div>'
      + '<div class="tc"><span>🎯</span><b>' + n + '/' + goal + '</b><small>today</small></div>'
      + '<button class="tc go' + (due ? ' hot' : '') + '" id="tc-review"><span>🃏</span><b>' + due + '</b><small>'
        + (due ? 'to review' : 'reviewed') + '</small></button></div>';
  }

  function paintRecent(){
    const last = items.slice(0, 8);
    $('recent').innerHTML = todayCard() + (last.length
      ? '<div class="recent-h">Recently saved</div><div class="recent">' + last.map(x => '<button data-w="' + esc(x.word) + '">' + esc(x.word)
          + (x.es ? '<small>' + esc(x.es.split(',')[0]) + '</small>' : '') + '</button>').join('') + '</div>'
      : '<div class="empty"><b>Heard a word you don’t know?</b><br>Type it above, or tap the microphone and say it.'
        + '<br><br>Tap 🎬 first to note what you are watching.</div>');
    $('recent').querySelectorAll('.recent button').forEach(b => b.addEventListener('click', () => look(b.dataset.w)));
    const rv = $('tc-review');
    if(rv) rv.addEventListener('click', () => { show('practice'); startCards(false); });
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
        saveItems(); paintList(); paintGoal(); paintCount(); paintDue();
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
  // --- settings: the gear in the top bar --------------------------------------
  function openSettings(){
    const sh = $('sheet');
    const sw = (id, on, label, sub) => '<label class="set-row"><span><b>' + label + '</b><small>' + sub + '</small></span>'
      + '<input type="checkbox" class="switch" id="' + id + '"' + (on ? ' checked' : '') + '></label>';
    const unsent = items.filter(x => !x.sent).length;
    sh.innerHTML = '<div class="sheet-in settings-sheet">'
      + '<div class="set-head"><h2>Settings</h2><button class="x" id="set-close" aria-label="Close">×</button></div>'
      + '<div class="set-stats">'
        + '<div><b>' + items.length + '</b><small>words</small></div>'
        + '<div><b>🔥 ' + streak() + '</b><small>day streak</small></div>'
        + '<div><b>⚡ ' + store.get('speedBest', 0) + '</b><small>speed record</small></div></div>'
      + '<div class="set-group"><div class="set-label">Daily goal</div><div class="seg" id="set-goal">'
        + [3, 5, 10, 15].map(n => '<button data-n="' + n + '"' + (+settings.goal === n ? ' class="on"' : '') + '>' + n + '</button>').join('')
        + '</div><small class="set-sub">words to catch each day</small></div>'
      + '<div class="set-group">'
        + sw('set-sound', settings.sound !== false, 'Sounds', 'A chime when you save or answer')
        + sw('set-vibrate', settings.vibrate !== false, 'Vibration', 'A little buzz on your phone')
      + '</div>'
      + '<div class="set-group">'
        + '<button class="set-row link" id="set-source"><span><b>What you are watching</b><small>'
          + esc(settings.source ? sourceLabel(settings.source) : 'Nothing set') + '</small></span><i>›</i></button>'
        + '<button class="set-row link" id="set-resend"><span><b>Send all my words to Word Log</b><small>'
          + (unsent ? unsent + ' not sent yet · ' : '') + 'Also keeps a copy in your OneDrive</small></span><i>›</i></button>'
      + '</div>'
      + '<p class="hint">Your words are kept on this phone.</p>'
      + '<p class="hint legal">© 2026 Eduardo Cruz · Word Pocket. Free for personal, non-commercial use under the '
        + '<a href="https://polyformproject.org/licenses/noncommercial/1.0.0" target="_blank" rel="noopener">PolyForm Noncommercial License</a>. '
        + 'It may not be sold. All other rights reserved.</p>'
      + '</div>';
    sh.hidden = false;
    const close = () => { sh.hidden = true; };
    $('set-close').addEventListener('click', close);
    sh.onclick = e => { if(e.target === sh) close(); };
    $('set-goal').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      settings.goal = +b.dataset.n; saveSettings(); paintGoal();
      $('set-goal').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if(!card) paintRecent();
    }));
    $('set-sound').addEventListener('change', e => { settings.sound = e.target.checked; saveSettings(); if(e.target.checked) chime(); });
    $('set-vibrate').addEventListener('change', e => { settings.vibrate = e.target.checked; saveSettings(); if(e.target.checked) buzz(30); });
    $('set-source').addEventListener('click', () => { close(); setTimeout(openSourceSheet, 120); });
    $('set-resend').addEventListener('click', () => { close(); sendToWordLog(items); });
  }
  $('gear').addEventListener('click', openSettings);

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

  // --- streak and celebrations --------------------------------------------------
  // A day counts when you save a word or practise. The streak is the run of
  // such days up to today (or up to yesterday, while today is still open).
  function markActive(){
    const days = store.get('days', []), t = todayKey();
    if(days[days.length - 1] !== t){ days.push(t); store.set('days', days.slice(-400)); }
    paintStreak();
  }
  function streak(){
    const days = new Set(store.get('days', []));
    const d = new Date();
    if(!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while(days.has(dayKey(d))){ n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function paintStreak(){
    const n = streak();
    $('streak').hidden = !n;
    $('streak-n').textContent = n;
    $('streak').classList.toggle('cold', store.get('days', []).slice(-1)[0] !== todayKey());
  }
  $('streak').addEventListener('click', () => {
    const n = streak(), today = store.get('days', []).slice(-1)[0] === todayKey();
    toast('🔥 <b>' + n + ' day' + (n === 1 ? '' : 's') + '</b> in a row.' + (today ? ' See you tomorrow!' : ' Save or practise a word today to keep it!'), 3500);
  });

  function confetti(){
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = ['#F2C14E', '#6FD08C', '#7FB2FF', '#E58AD1', '#FF9F43'];
    for(let i = 0; i < 70; i++){
      const p = document.createElement('i');
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.35) + 's';
      p.style.animationDuration = (1.4 + Math.random() * 1.1) + 's';
      p.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
      p.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg');
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3200);
  }

  // --- practice -----------------------------------------------------------------
  let game = null;
  const shuffle = a => { a = a.slice(); for(let i = a.length - 1; i > 0; i--){ const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const firstEs = x => String(x.es || '').split(',')[0].trim();
  const playable = () => items.filter(x => x.word && firstEs(x));

  function gapOf(x){
    if(!x.sentence) return null;
    const forms = formsOf(x.word).sort((a, b) => b.length - a.length).map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const m = x.sentence.match(new RegExp('(?<![\\p{L}])(' + forms.join('|') + ')(?![\\p{L}])', 'iu'));
    return m ? { before: x.sentence.slice(0, m.index), after: x.sentence.slice(m.index + m[0].length) } : null;
  }

  // Flashcards use spaced repetition: "I know it" moves a word up a box and
  // further away (1, 3, 7, 14, 30 days); "Again" brings it back tomorrow.
  const BOX_DAYS = [0, 1, 3, 7, 14, 30];
  const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
  const dueWords = () => items.filter(x => x.word && (!x.due || x.due <= todayKey()));
  function paintDue(){ const n = dueWords().length; $('due').textContent = n ? String(n) : ''; }

  function stopTimer(){ if(game && game.timer){ clearInterval(game.timer); game.timer = null; } }

  function practiceMenu(){
    stopTimer();
    game = null;
    const pool = playable().length, due = dueWords().length, best = store.get('speedBest', 0);
    const mode = (id, icon, title, sub, locked, hot) => '<button class="mode' + (hot ? ' hot' : '') + '" data-mode="' + id + '"'
      + (locked ? ' disabled' : '') + '><span class="m-icon">' + icon + '</span><b>' + title + '</b><small>' + sub + '</small></button>';
    const lock = pool < 4;
    $('game').innerHTML = '<div class="p-head"><h2>Practice</h2><span>' + items.length + ' word' + (items.length === 1 ? '' : 's') + ' in your pocket</span></div>'
      + '<div class="modes">'
        + mode('cards', '🃏', 'Flashcards', !items.length ? 'Save words first' : due ? due + ' to review' : 'All caught up ✓', !items.length, due > 0)
        + mode('quiz', '🎯', 'Quiz', lock ? 'Needs 4 words' : '8 questions', lock)
        + mode('listen', '🎧', 'Listen', lock ? 'Needs 4 words' : 'Hear it, find it', lock)
        + mode('speed', '⚡', 'Speed round', lock ? 'Needs 4 words' : best ? 'Best: ' + best : '60 seconds', lock)
      + '</div>'
      + (lock ? '<p class="hint" style="text-align:center">Save ' + (4 - pool) + ' more word' + (4 - pool === 1 ? '' : 's') + ' to unlock the games.</p>' : '');
    $('game').querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
      const m = b.dataset.mode;
      if(m === 'cards') startCards(false);
      else if(m === 'speed') startSpeed();
      else startQuiz(m);
    }));
  }

  // --- flashcards: tap to turn, swipe right if you know it, left to see it again
  function startCards(all){
    let list = (all ? items.slice() : dueWords()).filter(x => x.word);
    list = shuffle(list).sort((a, b) => (a.box || 0) - (b.box || 0)).slice(0, 20);
    if(!list.length){
      $('game').innerHTML = '<div class="g-end"><div class="g-score great">✓</div><div class="g-ask">All caught up!</div>'
        + '<p class="hint">Every word is resting until its next review.</p>'
        + '<div class="g-btns"><button class="btn" id="fc-all">Review all anyway</button><button class="ghost" id="fc-menu">Practice</button></div></div>';
      $('fc-all').addEventListener('click', () => startCards(true));
      $('fc-menu').addEventListener('click', practiceMenu);
      return;
    }
    game = { mode: 'cards', list, i: 0, known: 0, again: 0, requeued: new Set(), total: list.length };
    paintFlash();
  }

  function paintFlash(){
    const g = game, x = g.list[g.i];
    const box = x.box || 0;
    $('game').innerHTML = '<div class="g-top"><button class="back" id="g-back" aria-label="Back">‹</button>'
        + '<div class="g-bar"><i style="width:' + (g.i / g.list.length * 100) + '%"></i></div>'
        + '<span class="fc-count">' + (g.i + 1) + '/' + g.list.length + '</span></div>'
      + '<div class="fc-stack">'
        + (g.list[g.i + 1] ? '<div class="fc fc-next"></div>' : '')
        + '<div class="fc" id="fc"><span class="fc-tag yes">I KNOW IT</span><span class="fc-tag no">AGAIN</span>'
          + '<div class="fc-in" id="fc-in">'
            + '<div class="fc-face fc-front"><div class="fc-word">' + esc(x.word) + '</div>'
              + (x.pron ? '<div class="c-pron">' + esc(x.pron) + '</div>' : '')
              + (x.source ? '<div class="g-src">' + esc(x.source) + '</div>' : '')
              + '<div class="fc-boxes">' + [1, 2, 3, 4, 5].map(n => '<i class="' + (n <= box ? 'on' : '') + '"></i>').join('') + '</div>'
              + '<div class="hint">Tap to see the meaning</div></div>'
            + '<div class="fc-face fc-back"><div class="fc-word small">' + esc(x.word) + '</div>'
              + '<div class="c-es">' + esc(x.es || '') + '</div>'
              + (x.meaning ? '<div class="fc-mean">' + esc(x.meaning) + '</div>' : '')
              + (x.sentence ? '<div class="fc-sent">“' + esc(x.sentence) + '”</div>' : '') + '</div>'
          + '</div></div></div>'
      + '<div class="fc-btns"><button class="fc-b no" id="fc-no" aria-label="Again">✕</button>'
        + '<button class="fc-b say" id="fc-say" aria-label="Listen">' + SPEAKER + '</button>'
        + '<button class="fc-b yes" id="fc-yes" aria-label="I know it">✓</button></div>'
      + '<p class="hint" style="text-align:center">Swipe right if you know it, left to see it again</p>';
    $('g-back').addEventListener('click', practiceMenu);
    $('fc-say').addEventListener('click', () => speak(x.word));
    $('fc-no').addEventListener('click', () => decide(false));
    $('fc-yes').addEventListener('click', () => decide(true));

    // dragging the card
    const fc = $('fc');
    let start = null, dx = 0, moved = false;
    fc.addEventListener('pointerdown', e => { start = { x: e.clientX, y: e.clientY }; dx = 0; moved = false; fc.setPointerCapture(e.pointerId); fc.style.transition = 'none'; });
    fc.addEventListener('pointermove', e => {
      if(!start) return;
      dx = e.clientX - start.x;
      if(Math.abs(dx) > 6) moved = true;
      fc.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 18) + 'deg)';
      fc.querySelector('.fc-tag.yes').style.opacity = Math.max(0, Math.min(1, dx / 90));
      fc.querySelector('.fc-tag.no').style.opacity = Math.max(0, Math.min(1, -dx / 90));
    });
    const end = () => {
      if(!start) return;
      start = null;
      fc.style.transition = '';
      if(Math.abs(dx) > 90) return decide(dx > 0);
      fc.style.transform = '';
      fc.querySelectorAll('.fc-tag').forEach(t => { t.style.opacity = 0; });
      if(!moved){ $('fc-in').classList.toggle('flip'); if($('fc-in').classList.contains('flip')) speak(x.word); }
    };
    fc.addEventListener('pointerup', end);
    fc.addEventListener('pointercancel', end);
  }

  function decide(know){
    const g = game;
    if(!g || g.mode !== 'cards' || g.busy) return;
    g.busy = true;
    const x = g.list[g.i];
    const fc = $('fc');
    fc.style.transition = 'transform .3s ease-in, opacity .3s';
    fc.style.transform = 'translateX(' + (know ? 140 : -140) + '%) rotate(' + (know ? 24 : -24) + 'deg)';
    fc.style.opacity = '0';
    fc.querySelector(know ? '.fc-tag.yes' : '.fc-tag.no').style.opacity = 1;
    if(know){
      // missed earlier in this round: it stays near, back tomorrow
      x.box = g.requeued.has(x.id) ? 1 : Math.min(5, (x.box || 0) + 1);
      x.due = addDays(BOX_DAYS[x.box]);
      g.known++;
    } else {
      x.box = 1;
      x.due = addDays(1);
      g.again++;
      // once more before the end of this round
      if(!g.requeued.has(x.id)){ g.requeued.add(x.id); g.list.push(x); }
    }
    saveItems(); markActive(); paintDue();
    buzz(know ? 15 : [30, 40, 30]);
    setTimeout(() => {
      if(game !== g) return;
      g.busy = false;
      g.i++;
      if(g.i < g.list.length) paintFlash(); else cardsEnd();
    }, 280);
  }

  function cardsEnd(){
    const g = game;
    const perfect = g.again === 0;
    $('game').innerHTML = '<div class="g-end"><div class="g-score' + (perfect ? ' great' : '') + '">' + g.total + '</div>'
      + '<div class="g-ask">' + (g.total === 1 ? 'word reviewed' : 'words reviewed') + '</div>'
      + '<div class="fc-sum"><span class="yes">✓ ' + g.known + ' known</span><span class="no">↺ ' + g.again + ' again</span></div>'
      + '<p class="hint">' + (perfect ? 'Perfect! They will come back in a few days.' : 'The ones marked again come back tomorrow.') + '</p>'
      + '<div class="g-btns"><button class="btn" id="g-menu">Practice</button></div></div>';
    $('g-menu').addEventListener('click', practiceMenu);
    if(perfect) confetti();
    chime(true);
    game = null;
  }

  // --- quiz, listen and the speed round ---------------------------------------
  function makeQ(x, kind, pool){
    const gap = kind === 'gap' ? gapOf(x) : null;
    if(kind === 'gap' && !gap) kind = Math.random() < 0.5 ? 'en' : 'es';
    const answer = kind === 'es' ? firstEs(x) : x.word;
    const opts = [answer];
    for(const o of shuffle(pool.filter(o => o.id !== x.id))){
      const v = kind === 'es' ? firstEs(o) : o.word;
      if(opts.length < 4 && v && opts.every(p => p.toLowerCase() !== v.toLowerCase())) opts.push(v);
    }
    return { x, kind, gap, answer, opts: shuffle(opts) };
  }

  // the words you miss most, and the ones not practised yet, come first
  function pick(pool, n){
    const weight = x => { const s = stats[x.id] || {}; return (s.w || 0) - (s.r || 0) * 0.7 - (s.t ? 0 : 1) + Math.random() * 0.8; };
    return pool.slice().sort((a, b) => weight(b) - weight(a)).slice(0, n);
  }

  function startQuiz(mode){
    const pool = playable();
    const kinds = mode === 'listen' ? ['listen'] : ['es', 'en', 'gap', 'listen'];
    const qs = shuffle(pick(pool, 8)).map((x, i) => makeQ(x, kinds[i % kinds.length], pool));
    game = { mode, qs, i: 0, right: 0, combo: 0, best: 0, missed: [], locked: false };
    paintQuestion();
  }

  function startSpeed(){
    const pool = playable();
    game = { mode: 'speed', pool, qs: [], i: 0, right: 0, combo: 0, best: 0, missed: [], locked: false,
             ends: Date.now() + 60000, timer: null };
    game.qs.push(makeQ(pick(pool, 1)[0], Math.random() < 0.5 ? 'es' : 'en', pool));
    paintQuestion();
    const g = game;
    g.timer = setInterval(() => {
      const left = Math.max(0, g.ends - Date.now());
      const bar = $('g-time');
      if(bar) bar.style.width = (left / 600) + '%';
      const sec = $('g-sec');
      if(sec) sec.textContent = Math.ceil(left / 1000);
      if(left <= 10000 && bar) bar.classList.add('late');
      if(!left){ clearInterval(g.timer); g.timer = null; if(game === g) speedEnd(); }
    }, 100);
  }

  function paintQuestion(){
    const g = game, q = g.qs[g.i];
    const ask = { es: 'What does it mean?', en: 'Which word is it?', gap: 'Which word completes it?', listen: 'Which word do you hear?' }[q.kind];
    const prompt = q.kind === 'es' ? '<div class="g-q">' + esc(q.x.word) + '</div>'
      : q.kind === 'en' ? '<div class="g-q es">' + esc(firstEs(q.x)) + '</div>'
      : q.kind === 'listen' ? '<button class="g-listen" id="g-listen" aria-label="Play again">' + SPEAKER + '</button>'
      : '<div class="g-sent">' + esc(q.gap.before) + '<u></u>' + esc(q.gap.after) + '</div>';
    const top = g.mode === 'speed'
      ? '<div class="g-top"><button class="back" id="g-back" aria-label="Back">‹</button><div class="g-bar time"><i id="g-time" style="width:'
        + (Math.max(0, g.ends - Date.now()) / 600) + '%"></i></div><span class="g-sec" id="g-sec">' + Math.ceil(Math.max(0, g.ends - Date.now()) / 1000)
        + '</span><span class="g-score-now">' + g.right + '</span></div>'
      : '<div class="g-top"><button class="back" id="g-back" aria-label="Back">‹</button><div class="g-bar"><i style="width:' + (g.i / g.qs.length * 100) + '%"></i></div>'
        + '<span class="g-combo" id="combo">' + (g.combo >= 2 ? '🔥 ' + g.combo : '') + '</span></div>';
    $('game').innerHTML = top
      + '<div class="g-card' + (g.mode === 'speed' ? ' quick' : '') + '"><div class="g-ask">' + ask + '</div>' + prompt
        + (q.x.source && g.mode !== 'speed' && q.kind !== 'listen' ? '<div class="g-src">' + esc(q.x.source) + '</div>' : '')
        + '<div class="g-opts">' + q.opts.map((o, k) => '<button class="g-opt" data-k="' + k + '">' + esc(o) + '</button>').join('') + '</div></div>'
      + (g.mode === 'speed' && g.combo >= 2 ? '<div class="g-combo pop" style="text-align:center;margin-top:10px">🔥 ' + g.combo + ' in a row</div>' : '');
    g.locked = false;
    $('g-back').addEventListener('click', practiceMenu);
    if(q.kind === 'listen'){
      const b = $('g-listen');
      b.addEventListener('click', () => { speak(q.x.word); b.classList.remove('playing'); void b.offsetWidth; b.classList.add('playing'); });
      setTimeout(() => speak(q.x.word), 250);
    } else if(q.kind === 'es' && g.mode !== 'speed') speak(q.x.word);
    $('game').querySelectorAll('.g-opt').forEach(b => b.addEventListener('click', () => answer(+b.dataset.k)));
  }

  function answer(k){
    const g = game;
    if(!g || g.locked || !g.qs) return;
    g.locked = true;
    const q = g.qs[g.i], ok = q.opts[k] === q.answer;
    const btns = $('game').querySelectorAll('.g-opt');
    btns.forEach((b, j) => { b.disabled = true; if(q.opts[j] === q.answer) b.classList.add('right'); });
    if(!ok){ btns[k].classList.add('wrong'); buzz([40, 60, 40]); }
    chime(ok);
    const s = stats[q.x.id] = stats[q.x.id] || {};
    if(ok){ g.right++; g.combo++; g.best = Math.max(g.best, g.combo); s.r = (s.r || 0) + 1; }
    else{ g.combo = 0; if(g.missed.indexOf(q.x) === -1) g.missed.push(q.x); s.w = (s.w || 0) + 1; }
    s.t = Date.now();
    store.set('stats', stats);
    if(g.i === 0) markActive();
    const c = $('combo');
    if(c){
      c.textContent = g.combo >= 2 ? '🔥 ' + g.combo : '';
      if(g.combo >= 2){ c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
    }
    if(g.mode === 'speed'){
      setTimeout(() => {
        if(game !== g || !g.timer) return;
        const last = q.x;
        const next = pick(g.pool.filter(x => x !== last), 3)[Math.random() * 3 | 0] || g.pool[0];
        g.qs.push(makeQ(next, Math.random() < 0.5 ? 'es' : 'en', g.pool));
        g.i++;
        paintQuestion();
      }, ok ? 300 : 800);
      return;
    }
    if(q.kind !== 'es' && q.kind !== 'listen') speak(q.x.word);
    setTimeout(() => {
      if(game !== g) return;
      g.i++;
      if(g.i < g.qs.length) paintQuestion(); else paintEnd();
    }, ok ? 900 : 1700);
  }

  function missedHtml(g){
    return g.missed.length ? '<div class="g-miss"><div class="g-ask" style="margin-bottom:6px">To look at again</div>'
      + g.missed.map(x => '<div><b>' + esc(x.word) + '</b> — <span>' + esc(x.es) + '</span></div>').join('') + '</div>' : '';
  }

  function paintEnd(){
    const g = game, n = g.qs.length, pct = g.right / n;
    const stars = pct >= 0.9 ? 3 : pct >= 0.6 ? 2 : 1;
    $('game').innerHTML = '<div class="g-end">'
      + '<div class="g-score' + (pct >= 0.9 ? ' great' : '') + '">' + g.right + '/' + n + '</div>'
      + '<div class="g-stars">' + [1, 2, 3].map(i => '<span style="color:' + (i <= stars ? '#F2C14E' : '#333A46') + '">★</span>').join('') + '</div>'
      + '<div class="g-ask">' + (pct === 1 ? 'Perfect round!' : pct >= 0.6 ? 'Nice work' : 'Keep going, they will stick')
        + (g.best >= 3 ? ' · best run ' + g.best : '') + '</div>'
      + missedHtml(g)
      + '<div class="g-btns"><button class="btn" id="g-again">Play again</button><button class="ghost" id="g-menu">Practice</button></div></div>';
    const mode = g.mode;
    $('g-again').addEventListener('click', () => startQuiz(mode));
    $('g-menu').addEventListener('click', practiceMenu);
    if(pct === 1) confetti();
    game = null;
  }

  function speedEnd(){
    const g = game, best = store.get('speedBest', 0), record = g.right > best && g.right > 0;
    if(record) store.set('speedBest', g.right);
    $('game').innerHTML = '<div class="g-end">'
      + '<div class="g-ask">Time’s up!</div>'
      + '<div class="g-score' + (record ? ' great' : '') + '">' + g.right + '</div>'
      + '<div class="g-ask">' + (record ? '🏆 New record!' : 'right answers · best ' + best) + '</div>'
      + (g.best >= 3 ? '<p class="hint">Best run: ' + g.best + ' in a row</p>' : '')
      + missedHtml(g)
      + '<div class="g-btns"><button class="btn" id="g-again">Play again</button><button class="ghost" id="g-menu">Practice</button></div></div>';
    $('g-again').addEventListener('click', startSpeed);
    $('g-menu').addEventListener('click', practiceMenu);
    if(record) confetti();
    chime(true);
    game = null;
  }

  // --- tabs and start -------------------------------------------------------------
  function show(view){
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    ['look', 'words', 'practice'].forEach(v => { $('view-' + v).hidden = v !== view; });
    if(view === 'words') paintList();
    if(view === 'practice') practiceMenu();
    else{ stopTimer(); game = null; }
    if(view === 'look' && !card) paintRecent();
    // each screen slides in
    const v = $('view-' + view);
    v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  document.querySelectorAll('.groupby button').forEach(b => b.classList.toggle('on', b.dataset.g === settings.groupBy));

  // days you saved words count for the streak too, including before it existed
  (() => {
    const d = new Set(store.get('days', []));
    items.forEach(x => { if(x.savedAt) d.add(dayKey(x.savedAt)); });
    store.set('days', [...d].sort().slice(-400));
  })();
  paintSource(); paintGoal(); paintCount(); paintStreak(); paintDue(); paintRecent();
  if(navigator.onLine) fillPending();

  // works offline once it has been opened
  if('serviceWorker' in navigator && location.protocol === 'https:'){
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // keep the words even if the phone runs short of space
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
