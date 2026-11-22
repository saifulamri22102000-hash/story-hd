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
  // Chart songs are commercial tracks, so they are not copied into the file.
  // WhatsApp's own Status music picker has them licensed: hand the title over.
  const use = el('button', 'chip on', '🎵 Pakai lagu ini');
  use.type = 'button';
  const guide = el('p', 'hint guide');
  guide.hidden = true;
  use.addEventListener('click', async () => {
    const name = `${title} ${artist}`.trim();
    let copied = false;
    try {
      await navigator.clipboard.writeText(name);
      copied = true;
    } catch (_) { /* clipboard unavailable */ }
    use.textContent = copied ? '✓ Judul disalin' : '🎵 Pakai lagu ini';
    guide.textContent = '';
    guide.appendChild(el('b', '', 'Punya file lagunya di HP? '));
    guide.appendChild(document.createTextNode('Pilih filenya, lagu langsung masuk ke foto/video: '));
    const pickFile = el('button', 'chip on', '📁 Pilih file lagu');
    pickFile.type = 'button';
    pickFile.addEventListener('click', () => $('musicInput').click());
    guide.appendChild(pickFile);
    guide.appendChild(el('br'));
    guide.appendChild(el('b', '', 'Belum punya? '));
    guide.appendChild(document.createTextNode(
      (copied ? 'Judul sudah disalin. ' : `Judul: ${name}. `) +
      'Kirim hasil ke WhatsApp → Status Saya → ketuk ♪ → tempel judul → pilih lagunya.'));
    guide.hidden = false;
  });
  acts.appendChild(use);
  acts.appendChild(mkLink('TikTok', 'https://www.tiktok.com/search?q=' + query));
  acts.appendChild(mkLink('YouTube', 'https://www.youtube.com/results?search_query=' + query));
  row.appendChild(acts);
  row.appendChild(guide);
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
  const [vw, vh] = rotatedSize(v.videoWidth || W, v.videoHeight || H);
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

/* ---------- free song search (Jamendo catalogue via Openverse) ---------- */

const SONG_API = 'https://api.openverse.org/v1/audio/';
// No-derivatives licences are left out: putting a song under a video is a derivative.
const SONG_LICENSES = 'by,by-sa,by-nc,by-nc-sa,cc0,pdm';
const MOODS = [
  ['Ceria', 'happy upbeat'], ['Santai', 'chill'], ['Sedih', 'sad piano'],
  ['Romantis', 'romantic'], ['Semangat', 'energetic'], ['Lo-fi', 'lofi'],
  ['Akustik', 'acoustic guitar'], ['Sinematik', 'cinematic'],
  ['Elektronik', 'electronic dance'], ['Hip-hop', 'hip hop beat'],
];
const song = { query: '', page: 0, busy: false };

function togglePreview(btn, url) {
  if (trendPlaying === btn) {
    stopTrendPreview();
    return;
  }
  stopTrendPreview();
  trendAudio.src = url;
  trendAudio.play().catch(() => stopTrendPreview());
  trendPlaying = btn;
  btn.textContent = '⏸ Berhenti';
  btn.classList.add('on');
}

function licenseLabel(r) {
  if (r.license === 'cc0') return 'CC0';
  if (r.license === 'pdm') return 'Domain publik';
  return ('CC ' + r.license + ' ' + (r.license_version || '')).toUpperCase().trim();
}

function songRow(r, i) {
  const url = httpsOnly(r.url);
  const row = el('div', 'trend-row song-row');
  row.style.animationDelay = Math.min(i, 12) * 30 + 'ms';
  const img = el('img');
  img.alt = '';
  img.loading = 'lazy';
  const thumb = httpsOnly(r.thumbnail);
  if (thumb) img.src = thumb;
  img.addEventListener('error', () => { img.removeAttribute('src'); });
  row.appendChild(img);
  const info = el('div');
  info.appendChild(el('div', 't', r.title || 'Tanpa judul'));
  const secs = Math.round((r.duration || 0) / 1000);
  const meta = [r.creator, secs ? fmtClock(secs).replace(/\.\d$/, '') : '', licenseLabel(r)];
  info.appendChild(el('div', 'a', meta.filter(Boolean).join(' · ')));
  row.appendChild(info);
  const acts = el('div', 'acts');
  const play = el('button', 'chip', '▶ Dengar');
  play.type = 'button';
  play.addEventListener('click', () => togglePreview(play, url));
  const use = el('button', 'chip on', '＋ Pakai lagu ini');
  use.type = 'button';
  use.addEventListener('click', () => useSong(r, use));
  acts.appendChild(play);
  acts.appendChild(use);
  row.appendChild(acts);
  return row;
}

async function searchSongs(query, more) {
  if (song.busy || !query) return;
  song.busy = true;
  const page = more ? song.page + 1 : 1;
  if (!more) {
    stopTrendPreview();
    $('songList').textContent = '';
    $('songMore').hidden = true;
  }
  $('songStatus').textContent = 'Mencari…';
  try {
    const url = `${SONG_API}?q=${encodeURIComponent(query)}&source=jamendo` +
      `&license=${SONG_LICENSES}&page_size=12&page=${page}`;
    const res = await fetch(url);
    if (res.status === 429) throw new Error('Batas pencarian tercapai. Coba lagi beberapa saat.');
    if (!res.ok) throw new Error('Pencarian gagal (' + res.status + ').');
    const data = await res.json();
    const results = (data.results || []).filter((r) => httpsOnly(r.url));
    const offset = $('songList').children.length;
    results.forEach((r, i) => $('songList').appendChild(songRow(r, offset + i)));
    song.query = query;
    song.page = page;
    $('songMore').hidden = page >= (data.page_count || 1);
    $('songStatus').textContent = $('songList').children.length
      ? `Hasil untuk “${query}”. Dengar dulu, lalu ketuk “Pakai lagu ini”.`
      : `Tidak ada hasil untuk “${query}”. Coba kata lain atau bahasa Inggris.`;
  } catch (err) {
    console.error(err);
    $('songStatus').textContent = err instanceof TypeError
      ? 'Tidak bisa terhubung. Periksa internet.'
      : err.message;
  } finally {
    song.busy = false;
  }
}

async function useSong(r, btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  stopTrendPreview();
  try {
    const res = await fetch(httpsOnly(r.url));
    if (!res.ok || !res.body) throw new Error('unduh gagal');
    const total = +res.headers.get('Content-Length') || 0;
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      btn.textContent = total ? `Mengunduh ${Math.round((got / total) * 100)}%` : 'Mengunduh…';
    }
    const safe = (r.title || 'lagu').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'lagu';
    const file = new File(parts, safe + '.mp3', { type: 'audio/mpeg' });
    const credit = `♪ “${r.title || 'Tanpa judul'}” oleh ${r.creator || 'tak dikenal'} ` +
      `(${licenseLabel(r)}) via Jamendo`;
    setMusic(file, r.license === 'cc0' || r.license === 'pdm' ? '' : credit);
    btn.textContent = '✓ Dipakai';
    $('musicOpts').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    console.error(err);
    btn.textContent = 'Gagal, coba lagi';
  } finally {
    btn.disabled = false;
  }
}

MOODS.forEach(([label, query]) => {
  const chip = el('button', 'chip', label);
  chip.type = 'button';
  chip.addEventListener('click', () => {
    $('songQuery').value = label;
    searchSongs(query, false);
  });
  $('songMoods').appendChild(chip);
});
$('songForm').addEventListener('submit', (e) => {
  e.preventDefault();
  searchSongs($('songQuery').value.trim(), false);
});
$('songMore').addEventListener('click', () => searchSongs(song.query, true));
$('creditBtn').addEventListener('click', () => {
  if (!state.musicCredit) return;
  const box = $('caption');
  if (!box.value.includes(state.musicCredit)) {
    box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + state.musicCredit;
  }
  $('creditBtn').textContent = '✓ Kredit ditambahkan';
});

/* ---------- motion extras ---------- */

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

document.addEventListener('pointerdown', (e) => {
  if (reducedMotion.matches || !(e.target instanceof Element)) return;
  const host = e.target.closest('.primary, .secondary, .pick, .chip');
  if (!host || host.disabled) return;
  const box = host.getBoundingClientRect();
  const d = Math.max(box.width, box.height);
  const dot = el('span', 'ripple');
  dot.style.width = dot.style.height = d + 'px';
  dot.style.left = e.clientX - box.left - d / 2 + 'px';
  dot.style.top = e.clientY - box.top - d / 2 + 'px';
  host.appendChild(dot);
  dot.addEventListener('animationend', () => dot.remove());
});

function confetti(host) {
  if (reducedMotion.matches) return;
  const colors = ['#25d366', '#34b7f1', '#ffe600', '#ff6b9d', '#ffffff'];
  const layer = el('div', 'confetti');
  for (let i = 0; i < 30; i++) {
    const bit = el('i');
    bit.style.setProperty('--x', (Math.random() * 2 - 1) * 170 + 'px');
    bit.style.setProperty('--y', -(40 + Math.random() * 170) + 'px');
    bit.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = Math.random() * 120 + 'ms';
    layer.appendChild(bit);
  }
  host.appendChild(layer);
  setTimeout(() => layer.remove(), 1800);
}

new MutationObserver(() => {
  if (!$('resultCard').hidden) confetti($('resultCard'));
}).observe($('resultCard'), { attributes: true, attributeFilter: ['hidden'] });

/* ---------- result review ---------- */

// Settings are captured when processing finishes, so the summary describes
// the file on screen even if the controls are changed afterwards.
let reviewStart = 0;

function reviewChip(text) {
  $('reviewInfo').appendChild(el('span', 'chip tag', text));
}

function buildReview(file) {
  const isVideo = file.type.startsWith('video');
  const fx = FX.find((f) => f.id === state.fx) || FX[0];
  reviewStart = state.kind === 'video' ? trimRange().start : 0;
  $('reviewInfo').textContent = '';

  const sizeChip = el('span', 'chip tag', '📐 …');
  $('reviewInfo').appendChild(sizeChip);
  if (isVideo) {
    const v = $('outVid');
    v.loop = true;
    v.addEventListener('loadedmetadata', () => {
      sizeChip.textContent = `📐 ${v.videoWidth}×${v.videoHeight} · ${v.duration.toFixed(1)} dtk`;
    }, { once: true });
    v.play().catch(() => { /* autoplay may be blocked; controls remain */ });
  } else {
    const img = $('outImg');
    img.addEventListener('load', () => {
      sizeChip.textContent = `📐 ${img.naturalWidth}×${img.naturalHeight}`;
    }, { once: true });
  }
  reviewChip('💾 ' + fmtSize(file.size));
  reviewChip('✨ ' + (fx.id === 'asli' ? 'Tanpa efek' : `${fx.label} ${$('fxAmount').value}%`));
  if (state.music) reviewChip('🎵 ' + state.music.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 28));
  else reviewChip(isVideo ? '🔊 Suara asli' : '🔇 Tanpa lagu');
  if (isVideo && state.kind === 'video' && state.subs.length) reviewChip(`💬 ${state.subs.length} teks otomatis`);
  if (burnsText()) reviewChip('🔤 Teks ditempel');
  setCompare(false);
}

function setCompare(before) {
  const outIsVideo = !!state.outFile && state.outFile.type.startsWith('video');
  const showVideo = before ? state.kind === 'video' : outIsVideo;
  const img = $('outImg'), vid = $('outVid');
  const original = $('imgPreview').dataset.url || '';
  const src = before ? original : state.outUrl;
  const at = vid.currentTime || 0;
  $('cmpBefore').classList.toggle('on', before);
  $('cmpAfter').classList.toggle('on', !before);
  $('cmpBefore').setAttribute('aria-pressed', String(before));
  $('cmpAfter').setAttribute('aria-pressed', String(!before));
  img.hidden = showVideo;
  vid.hidden = !showVideo;
  if (!showVideo) {
    vid.pause();
    if (img.src !== src) img.src = src;
    return;
  }
  if (vid.src === src) return;
  const wasVideo = !!vid.src && !vid.paused;
  vid.src = src;
  vid.loop = !before;
  vid.addEventListener('loadedmetadata', () => {
    // Keep the same moment on screen: the output starts at the trim point.
    const t = before ? at + reviewStart : at - reviewStart;
    if (Number.isFinite(t) && t > 0 && t < vid.duration) vid.currentTime = t;
    if (wasVideo) vid.play().catch(() => {});
  }, { once: true });
}

$('cmpAfter').addEventListener('click', () => setCompare(false));
$('cmpBefore').addEventListener('click', () => setCompare(true));
$('editAgain').addEventListener('click', () => {
  $('outVid').pause();
  $('settings').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
