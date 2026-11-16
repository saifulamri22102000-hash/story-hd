'use strict';
// Trending songs and auto captions. Loaded after app.js and shares its globals.

/* ---------- trending songs ---------- */

const TREND_URL = 'https://itunes.apple.com/id/rss/topsongs/limit=25/json';
const trendAudio = new Audio();
let trendLoaded = false;
let trendPlaying = null;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function httpsOnly(url) {
  return typeof url === 'string' && url.startsWith('https://') ? url : '';
}

function stopTrendPreview() {
  trendAudio.pause();
  if (trendPlaying) {
    trendPlaying.textContent = '▶ Dengar';
    trendPlaying.classList.remove('on');
  }
  trendPlaying = null;
}

function trendRow(entry, i) {
  const title = (entry['im:name'] && entry['im:name'].label) || '';
  const artist = (entry['im:artist'] && entry['im:artist'].label) || '';
  const images = entry['im:image'] || [];
  const cover = httpsOnly(images.length ? images[images.length - 1].label : '');
  const links = [].concat(entry.link || []);
  const previewLink = links.find((l) => l.attributes && l.attributes['im:assetType'] === 'preview');
  const preview = httpsOnly(previewLink && previewLink.attributes.href);
  const query = encodeURIComponent(`${title} ${artist}`.trim());

  const row = el('div', 'trend-row');
  row.style.animationDelay = Math.min(i, 12) * 30 + 'ms';
  row.appendChild(el('span', 'rank', String(i + 1)));
  const img = el('img');
  img.alt = '';
  img.loading = 'lazy';
  if (cover) img.src = cover;
  row.appendChild(img);
  const info = el('div');
  info.appendChild(el('div', 't', title));
  info.appendChild(el('div', 'a', artist));
  row.appendChild(info);

  const acts = el('div', 'acts');
  if (preview) {
    const play = el('button', 'chip', '▶ Dengar');
    play.type = 'button';
    play.addEventListener('click', () => {
      if (trendPlaying === play) {
        stopTrendPreview();
        return;
      }
      stopTrendPreview();
      trendAudio.src = preview;
      trendAudio.play().catch(() => stopTrendPreview());
      trendPlaying = play;
      play.textContent = '⏸ Berhenti';
      play.classList.add('on');
    });
    acts.appendChild(play);
  }
  const mkLink = (label, href) => {
    const a = el('a', 'chip', label);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };
  acts.appendChild(mkLink('TikTok', 'https://www.tiktok.com/search?q=' + query));
  acts.appendChild(mkLink('YouTube', 'https://www.youtube.com/results?search_query=' + query));
  row.appendChild(acts);
  return row;
}

async function loadTrends() {
  if (trendLoaded) return;
  const box = $('trendList');
  box.textContent = 'Memuat…';
  try {
    const res = await fetch(TREND_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const entries = [].concat((data.feed && data.feed.entry) || []);
    if (!entries.length) throw new Error('kosong');
    box.textContent = '';
    entries.forEach((entry, i) => box.appendChild(trendRow(entry, i)));
    trendLoaded = true;
  } catch (err) {
    console.error(err);
    box.textContent = 'Gagal memuat daftar. Periksa internet, lalu buka lagi.';
  }
}

trendAudio.addEventListener('ended', stopTrendPreview);
$('trend').addEventListener('toggle', () => {
  if ($('trend').open) loadTrends();
  else stopTrendPreview();
});

/* ---------- auto captions (speech to text) ---------- */

const FONTS = {
  poppins: { family: 'Poppins', file: 'Poppins-Bold.ttf', bold: true },
  bebas: { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf' },
  anton: { family: 'Anton', file: 'Anton-Regular.ttf' },
  bangers: { family: 'Bangers', file: 'Bangers-Regular.ttf' },
  pacifico: { family: 'Pacifico', file: 'Pacifico-Regular.ttf' },
  marker: { family: 'Permanent Marker', file: 'PermanentMarker-Regular.ttf' },
};
const SUB_SIZE = { kecil: 0.045, sedang: 0.06, besar: 0.08 };

// Captions are stored in the time base of their source file (video or song),
// so trimming afterwards only shifts them instead of invalidating them.
state.subs = [];
state.subRaw = null;
state.subSource = 'video';

let sttWorker = null;

function trimRange() {
  const start = Math.max(0, num('start', 0));
  const available = state.duration > 0 ? Math.max(0.5, state.duration - start) : Infinity;
  return { start, seconds: Math.max(0.5, Math.min(num('dur', 30), available)) };
}

function videoOutSize() {
  const { W, H } = dims();
  if ($('mode').value !== 'asli') return { w: W, h: H };
  const v = $('vidPreview');
  const vw = v.videoWidth || W, vh = v.videoHeight || H;
  const s = Math.min(1, H / Math.max(vw, vh));
  return { w: even(vw * s), h: even(vh * s) };
}

function setSubStatus(text, pct) {
  $('subStatus').textContent = text;
  $('subBar').hidden = pct == null;
  if (pct != null) $('subBar').firstElementChild.style.width = Math.max(3, Math.min(100, pct)) + '%';
}

function transcribe(audio, model, language) {
  if (!sttWorker) sttWorker = new Worker('stt-worker.js', { type: 'module' });
  const worker = sttWorker;
  return new Promise((resolve, reject) => {
    const files = {};
    const fail = (message) => {
      // A broken worker cannot be reused, start fresh next time.
      worker.terminate();
      sttWorker = null;
      reject(new Error(message));
    };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'download') {
        files[m.file] = m.progress || 0;
        const vals = Object.values(files);
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        setSubStatus('Mengunduh model suara (sekali saja)… ' + Math.round(avg) + '%', avg);
      } else if (m.type === 'stage') {
        setSubStatus('Mengenali suara… bisa 1–3 menit, jangan tutup halaman.', 100);
      } else if (m.type === 'done') {
        resolve(m.chunks);
      } else if (m.type === 'error') {
        fail('Gagal mengenali suara: ' + m.message);
      }
    };
    worker.onerror = () => fail('Mesin pengenal suara gagal dimuat. Periksa internet.');
    worker.postMessage({ audio, model, language }, [audio.buffer]);
  });
}

function splitChunks(chunks, base, total, perLine) {
  const out = [];
  for (const c of chunks) {
    const text = (c.text || '').trim();
    // Whisper emits bracketed tags such as [Musik] for non-speech.
    if (!text || /^[\[(].*[\])]$/.test(text)) continue;
    const s = c.timestamp && c.timestamp[0] != null ? c.timestamp[0] : 0;
    let e = c.timestamp && c.timestamp[1] != null ? c.timestamp[1] : null;
    if (e == null || e <= s) e = Math.min(total, s + Math.max(1, text.length * 0.07));
    const words = text.split(/\s+/);
    const allChars = words.join('').length || 1;
    let t = s;
    for (let i = 0; i < words.length; i += perLine) {
      const part = words.slice(i, i + perLine);
      const d = ((e - s) * part.join('').length) / allChars;
      out.push({ s: base + t, e: base + t + d, text: part.join(' ') });
      t += d;
    }
  }
  return out;
}

function fmtClock(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

function renderSubs() {
  const list = $('subList');
  list.textContent = '';
  const base = state.subRaw ? state.subRaw.base : 0;
  state.subs.forEach((sub) => {
    const clock = fmtClock(Math.max(0, sub.s - base));
    const row = el('div', 'sub-row');
    row.appendChild(el('span', 'time', clock));
    const input = el('input');
    input.type = 'text';
    input.value = sub.text;
    input.setAttribute('aria-label', 'Teks pada ' + clock);
    input.addEventListener('input', () => { sub.text = input.value; });
    row.appendChild(input);
    const del = el('button', '', '×');
    del.type = 'button';
    del.setAttribute('aria-label', 'Hapus baris');
    del.addEventListener('click', () => {
      state.subs = state.subs.filter((x) => x !== sub);
      renderSubs();
    });
    row.appendChild(del);
    list.appendChild(row);
  });
  $('subEditor').hidden = state.subs.length === 0 && !state.subRaw;
}

function resplitSubs() {
  if (!state.subRaw) return;
  const r = state.subRaw;
  state.subs = splitChunks(r.chunks, r.base, r.total, parseInt($('subWords').value, 10) || 4);
  renderSubs();
}

function clearSubs() {
  state.subs = [];
  state.subRaw = null;
  renderSubs();
  setSubStatus('');
}

async function onTranscribe() {
  if (state.busy || state.kind !== 'video') return;
  const source = $('subSource').value;
  if (source === 'music' && !state.music) {
    setSubStatus('Tambahkan lagu dulu di langkah 3.');
    return;
  }
  state.busy = true;
  $('subBtn').disabled = true;
  $('processBtn').disabled = true;
  showError('');
  try {
    const { start, seconds } = trimRange();
    const base = source === 'video' ? start : Math.max(0, num('musicStart', 0));
    const file = source === 'video' ? state.media : state.music;
    setSubStatus('Mengambil suara…', 5);
    const f = await getFFmpeg();
    const name = 'stt.' + extOf(file, 'mp4');
    await writeInput(f, name, file);
    let pcm;
    try {
      const code = await run(f, [
        '-ss', String(base), '-t', String(seconds), '-i', name,
        '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'stt.pcm',
      ], 0);
      if (code !== 0) throw new Error('File ini tidak punya suara yang bisa dibaca.');
      pcm = await f.readFile('stt.pcm');
    } finally {
      await cleanup(f, [name, 'stt.pcm']);
    }
    if (!pcm || pcm.length < 16000) throw new Error('Suaranya terlalu pendek atau kosong.');
    const audio = new Float32Array(pcm.slice().buffer, 0, Math.floor(pcm.length / 4));
    setSubStatus('Menyiapkan pengenal suara…', 8);
    const chunks = await transcribe(audio, $('subModel').value, $('subLang').value);
    state.subRaw = { chunks, base, total: seconds };
    state.subSource = source;
    resplitSubs();
    setSubStatus(state.subs.length
      ? `Selesai: ${state.subs.length} potongan teks. Periksa dan edit bila perlu.`
      : 'Tidak ada ucapan yang terdeteksi.');
  } catch (err) {
    console.error(err);
    setSubStatus(err && err.message ? err.message : String(err));
  } finally {
    state.busy = false;
    $('subBtn').disabled = false;
    $('processBtn').disabled = false;
  }
}

/* ASS subtitle generation (rendered by libass inside ffmpeg) */

function assTime(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const p = (n) => String(n).padStart(2, '0');
  return `${Math.floor(cs / 360000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`;
}

function assColor(hex, alpha) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) || [0, 'ff', 'ff', 'ff'];
  return `&H${alpha || '00'}${m[3]}${m[2]}${m[1]}`.toUpperCase();
}

function assEscape(text) {
  return text.replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ').trim();
}

function buildAss(w, h, lines) {
  const font = FONTS[$('subFont').value] || FONTS.poppins;
  const size = Math.round(w * (SUB_SIZE[$('subSize').value] || SUB_SIZE.sedang));
  const effect = $('subEffect').value;
  const box = $('subBox').checked;
  const upper = $('subUpper').checked;
  const pos = $('subPos').value;
  const align = pos === 'atas' ? 8 : pos === 'tengah' ? 5 : 2;
  const mv = Math.round(h * 0.12);
  const mlr = Math.round(w * 0.07);
  const x = Math.round(w / 2);
  const y = pos === 'atas' ? mv : pos === 'tengah' ? Math.round(h / 2) : h - mv;
  const textCol = assColor($('subColor').value);
  const primary = effect === 'karaoke' ? assColor($('subHi').value) : textCol;
  const outline = box ? Math.round(size * 0.25) : Math.max(2, Math.round(size * 0.08));
  const style = [
    'Cap', font.family, size, primary, textCol,
    box ? '&H90000000' : assColor($('subOutline').value), '&H90000000',
    font.bold ? -1 : 0, 0, 0, 0, 100, 100, 0, 0,
    box ? 3 : 1, outline, box ? 0 : Math.round(size * 0.04),
    align, mlr, mlr, mv, 1,
  ].join(',');

  const events = lines.map((line) => {
    let text = assEscape(line.text);
    if (upper) text = text.toUpperCase();
    if (!text) return '';
    const durMs = Math.round((line.e - line.s) * 1000);
    const words = text.split(/\s+/);
    const chars = words.join('').length || 1;
    let body;
    if (effect === 'karaoke') {
      body = words
        .map((wd) => `{\\k${Math.max(1, Math.round(((durMs / 10) * wd.length) / chars))}}${wd}`)
        .join(' ');
    } else if (effect === 'kata') {
      let t = 0;
      body = words.map((wd) => {
        const at = Math.round(t);
        t += (durMs * 0.8 * wd.length) / chars;
        return `{\\alpha&HFF&\\t(${at},${at + 1},\\alpha&H00&)}${wd}`;
      }).join(' ');
    } else if (effect === 'pop') {
      body = '{\\fscx55\\fscy55\\t(0,140,\\fscx110\\fscy110)\\t(140,220,\\fscx100\\fscy100)}' + text;
    } else if (effect === 'naik') {
      body = `{\\move(${x},${y + size},${x},${y},0,220)\\fad(150,0)}` + text;
    } else if (effect === 'fade') {
      body = '{\\fad(160,160)}' + text;
    } else {
      body = text;
    }
    return `Dialogue: 0,${assTime(line.s)},${assTime(line.e)},Cap,,0,0,0,,${body}`;
  }).filter(Boolean);

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: ' + style,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

// Caption lines relative to the start of the output clip.
function subsForClip(start, seconds) {
  if (!state.subs.length) return [];
  const origin = state.subSource === 'video' ? start : Math.max(0, num('musicStart', 0));
  return state.subs
    .map((sub) => ({ s: sub.s - origin, e: sub.e - origin, text: sub.text }))
    .filter((sub) => sub.text.trim() && sub.e > 0.05 && sub.s < seconds)
    .map((sub) => {
      const s = Math.max(0, sub.s);
      return { s, e: Math.min(seconds, Math.max(sub.e, s + 0.3)), text: sub.text };
    });
}

async function writeSubtitleFiles(f, lines) {
  const { w, h } = videoOutSize();
  const font = FONTS[$('subFont').value] || FONTS.poppins;
  const res = await fetch('vendor/fonts/' + font.file);
  if (!res.ok) throw new Error('Font teks gagal dimuat.');
  try { await f.createDir('fonts'); } catch (_) { /* already there */ }
  await f.writeFile('fonts/' + font.file, new Uint8Array(await res.arrayBuffer()));
  await f.writeFile('subs.ass', new TextEncoder().encode(buildAss(w, h, lines)));
}

function updateSubPreview() {
  const font = FONTS[$('subFont').value] || FONTS.poppins;
  const span = $('subPreview').firstElementChild;
  const box = $('subBox').checked;
  const o = $('subOutline').value;
  span.style.fontFamily = `"${font.family}", sans-serif`;
  span.style.fontWeight = font.bold ? '700' : '400';
  span.style.color = $('subColor').value;
  span.style.textTransform = $('subUpper').checked ? 'uppercase' : 'none';
  span.style.background = box ? 'rgba(0,0,0,.6)' : 'transparent';
  span.style.textShadow = box ? 'none'
    : `-2px -2px 0 ${o}, 2px -2px 0 ${o}, -2px 2px 0 ${o}, 2px 2px 0 ${o}, 0 3px 6px rgba(0,0,0,.5)`;
  span.style.fontSize = { kecil: '1.2rem', sedang: '1.6rem', besar: '2.1rem' }[$('subSize').value];
  span.querySelector('.hi').style.color =
    $('subEffect').value === 'karaoke' ? $('subHi').value : 'inherit';
}

$('subBtn').addEventListener('click', onTranscribe);
$('subClear').addEventListener('click', clearSubs);
$('subWords').addEventListener('change', resplitSubs);
['subFont', 'subEffect', 'subSize', 'subColor', 'subOutline', 'subHi', 'subBox', 'subUpper']
  .forEach((id) => $(id).addEventListener('input', updateSubPreview));
updateSubPreview();
