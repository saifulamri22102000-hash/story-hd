'use strict';

const $ = (id) => document.getElementById(id);

// WhatsApp re-compresses anything large, so the output is kept under this size.
const MAX_BYTES = 15.5 * 1024 * 1024;
const AUDIO_KBPS = 128;
const PHOTO_FPS = 15;

const state = {
  media: null,      // File chosen by the user
  kind: null,       // 'image' | 'video'
  duration: 0,      // source video duration in seconds
  music: null,      // File
  outUrl: null,
  outFile: null,
  busy: false,
};

let ffmpeg = null;
let logTail = [];
let progressTotal = 0;

/* ---------- small helpers ---------- */

function fmtSize(bytes) {
  return bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + ' MB'
    : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function extOf(file, fallback) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(file.name || '');
  return m ? m[1].toLowerCase() : fallback;
}

function num(id, fallback) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : fallback;
}

function setStatus(text, pct) {
  $('status').textContent = text;
  if (pct != null) {
    const p = Math.max(0, Math.min(100, pct));
    $('progress').firstElementChild.style.width = p + '%';
    $('progress').setAttribute('aria-valuenow', String(Math.round(p)));
  }
}

/* ---------- status text ---------- */

function captionText() {
  return $('caption').value.trim();
}

function burnsText() {
  return $('burnText').checked && captionText() !== '';
}

// Word-wraps the caption for a frame `cw` pixels wide.
function layoutText(ctx, text, cw) {
  const fs = Math.max(14, Math.round(cw * 0.055));
  const pad = Math.round(fs * 0.6);
  const lh = Math.round(fs * 1.3);
  const font = `700 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.font = font;
  const maxW = cw * 0.86 - pad * 2;
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > maxW) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  const kept = lines.slice(0, 8);
  const widest = Math.max(...kept.map((l) => ctx.measureText(l).width));
  return {
    lines: kept, font, lh, pad,
    bw: Math.ceil(Math.min(cw, widest + pad * 2)),
    bh: kept.length * lh + pad * 2,
  };
}

function paintText(ctx, L, x, y) {
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, L.bw, L.bh, L.pad);
  else ctx.rect(x, y, L.bw, L.bh);
  ctx.fill();
  ctx.font = L.font;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  L.lines.forEach((l, i) => ctx.fillText(l, x + L.bw / 2, y + L.pad + L.lh * (i + 0.5)));
}

function textY(ch, bh) {
  const pos = $('textPos').value;
  if (pos === 'atas') return ch * 0.08;
  if (pos === 'tengah') return (ch - bh) / 2;
  return ch - bh - ch * 0.12;
}

// Transparent PNG holding only the caption box, overlaid on video by ffmpeg.
async function makeTextPng(frameWidth) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const L = layoutText(ctx, captionText(), frameWidth);
  canvas.width = L.bw;
  canvas.height = L.bh;
  paintText(ctx, L, 0, 0);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Teks tidak bisa dibuat.');
  return blob;
}

function videoOutWidth() {
  const { W, H } = dims();
  if ($('mode').value !== 'asli') return W;
  const v = $('vidPreview');
  const vw = v.videoWidth || W, vh = v.videoHeight || H;
  return even(vw * Math.min(1, H / Math.max(vw, vh)));
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = !msg;
}

function dims() {
  const q = parseInt($('quality').value, 10);
  return { q, W: q, H: (q * 16) / 9 };
}

/* ---------- ffmpeg ---------- */

async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (!window.FFmpegWASM) throw new Error('Mesin video gagal dimuat. Muat ulang halaman.');
  const f = new FFmpegWASM.FFmpeg();
  f.on('log', ({ message }) => {
    logTail.push(message);
    if (logTail.length > 300) logTail.shift();
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
    if (m && progressTotal > 0) {
      const t = +m[1] * 3600 + +m[2] * 60 + +m[3];
      const pct = Math.min(99, (t / progressTotal) * 100);
      setStatus('Memproses… ' + Math.round(pct) + '%', pct);
    }
  });
  const base = new URL('vendor/ffmpeg/', location.href).href;
  await f.load({
    coreURL: base + 'ffmpeg-core.js',
    wasmURL: base + 'ffmpeg-core.wasm',
  });
  ffmpeg = f;
  return f;
}

async function run(f, args, total) {
  logTail = [];
  progressTotal = total || 0;
  const code = await f.exec(args);
  progressTotal = 0;
  return code;
}

async function writeInput(f, name, blob) {
  await f.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
}

async function cleanup(f, names) {
  for (const n of names) {
    try { await f.deleteFile(n); } catch (_) { /* file may not exist */ }
  }
}

// The music source may be a song or a video; either way it must carry sound.
async function assertHasAudio(f, name) {
  await run(f, ['-hide_banner', '-i', name], 0);
  if (!logTail.some((l) => /Stream #0:\d+.*Audio:/.test(l))) {
    throw new Error('File yang dipilih untuk lagu tidak punya suara.');
  }
}

function videoBitrate(q, seconds) {
  const cap = q === 1080 ? 6000 : 3500;
  const fit = Math.floor((MAX_BYTES * 8) / 1000 / seconds - AUDIO_KBPS - 16);
  return Math.max(700, Math.min(cap, fit));
}

function encodeArgs(q, seconds, extra) {
  const vb = videoBitrate(q, seconds);
  return [
    '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
    '-maxrate', vb + 'k', '-bufsize', vb * 2 + 'k',
    '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
    ...extra,
    '-c:a', 'aac', '-b:a', AUDIO_KBPS + 'k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart',
    'out.mp4',
  ];
}

/* ---------- photo rendering (canvas) ---------- */

async function loadBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (_) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function even(n) {
  return Math.max(2, Math.round(n / 2) * 2);
}

async function renderPhoto(file, forVideo) {
  const { q, W, H } = dims();
  const mode = $('mode').value;
  const bmp = await loadBitmap(file);
  const iw = bmp.width, ih = bmp.height;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (mode === 'asli') {
    const maxLong = forVideo ? H : (q === 1080 ? 2560 : 1920);
    const s = Math.min(1, maxLong / Math.max(iw, ih));
    canvas.width = forVideo ? even(iw * s) : Math.round(iw * s);
    canvas.height = forVideo ? even(ih * s) : Math.round(ih * s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  } else {
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingQuality = 'high';
    const cover = Math.max(W / iw, H / ih);
    const drawScaled = (s) =>
      ctx.drawImage(bmp, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    if (mode === 'crop') {
      drawScaled(cover);
    } else {
      // Blurred, darkened copy as the backdrop, full photo on top.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      if ('filter' in ctx) {
        ctx.filter = 'blur(' + Math.round(W / 22) + 'px)';
        drawScaled(cover * 1.15);
        ctx.filter = 'none';
      }
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, W, H);
      drawScaled(Math.min(W / iw, H / ih));
    }
  }
  if (burnsText()) {
    const L = layoutText(ctx, captionText(), canvas.width);
    paintText(ctx, L, (canvas.width - L.bw) / 2, textY(canvas.height, L.bh));
  }
  if (bmp.close) bmp.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
  if (!blob) throw new Error('Foto tidak bisa diproses.');
  return blob;
}

/* ---------- processing ---------- */

async function processPhotoOnly() {
  setStatus('Memproses foto…', 40);
  const blob = await renderPhoto(state.media, false);
  return new File([blob], outName('jpg'), { type: 'image/jpeg' });
}

async function processPhotoWithMusic() {
  const { q } = dims();
  const seconds = Math.max(3, Math.min(60, num('photoDur', 30)));
  setStatus('Menyiapkan foto…', 2);
  const photo = await renderPhoto(state.media, true);
  setStatus('Memuat mesin video (sekali saja)…', 5);
  const f = await getFFmpeg();
  const musName = 'music.' + extOf(state.music, 'mp3');
  await writeInput(f, 'photo.jpg', photo);
  await writeInput(f, musName, state.music);
  const vol = (num('musicVol', 100) / 100).toFixed(2);
  const args = [
    '-loop', '1', '-framerate', String(PHOTO_FPS), '-i', 'photo.jpg',
    '-stream_loop', '-1', '-ss', String(Math.max(0, num('musicStart', 0))), '-i', musName,
    '-filter_complex', `[0:v]format=yuv420p[v];[1:a]volume=${vol}[a]`,
    '-map', '[v]', '-map', '[a]',
    ...encodeArgs(q, seconds, ['-tune', 'stillimage', '-r', String(PHOTO_FPS)]),
  ];
  try {
    await assertHasAudio(f, musName);
    const code = await run(f, args, seconds);
    if (code !== 0) throw ffmpegError();
    return await readOutput(f);
  } finally {
    await cleanup(f, ['photo.jpg', musName, 'out.mp4']);
  }
}

async function processVideo() {
  const { q, W, H } = dims();
  const mode = $('mode').value;
  const start = Math.max(0, num('start', 0));
  const available = state.duration > 0 ? Math.max(0.5, state.duration - start) : Infinity;
  const seconds = Math.max(0.5, Math.min(num('dur', 30), available));

  setStatus('Memuat mesin video (sekali saja)…', 2);
  const f = await getFFmpeg();
  const inName = 'input.' + extOf(state.media, 'mp4');
  const musName = state.music ? 'music.' + extOf(state.music, 'mp3') : null;
  setStatus('Membaca video…', 4);
  await writeInput(f, inName, state.media);
  if (musName) await writeInput(f, musName, state.music);
  const textName = burnsText() ? 'text.png' : null;
  if (textName) await writeInput(f, textName, await makeTextPng(videoOutWidth()));

  try {
    if (musName) await assertHasAudio(f, musName);
    // Probe: ffmpeg exits non-zero here by design, only the log matters.
    await run(f, ['-hide_banner', '-i', inName], 0);
    const hasAudio = logTail.some((l) => /Stream #0:\d+.*Audio:/.test(l));
    if (!logTail.some((l) => /Stream #0:\d+.*Video:/.test(l))) {
      throw new Error('File ini tidak berisi video yang bisa dibaca.');
    }

    let vf;
    if (mode === 'fit') {
      vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`;
    } else if (mode === 'crop') {
      vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    } else {
      vf = `scale='min(${H},iw)':'min(${H},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
    }
    vf += ',setsar=1,format=yuv420p';

    const subLines = subsForClip(start, seconds);
    if (subLines.length) {
      await writeSubtitleFiles(f, subLines);
      vf += ',ass=subs.ass:fontsdir=fonts';
    }

    const mv = (num('musicVol', 100) / 100).toFixed(2);
    const ovNum = musName ? num('origVol', 0) / 100 : 1;
    const ov = ovNum.toFixed(2);
    const keepOrig = hasAudio && ovNum > 0;

    let af = '';
    if (musName && keepOrig) {
      af = `;[0:a]volume=${ov}[a0];[1:a]volume=${mv}[a1];` +
        '[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[a]';
    } else if (musName) {
      af = `;[1:a]volume=${mv}[a]`;
    } else if (keepOrig) {
      af = ';[0:a]anull[a]';
    }

    const args = ['-ss', String(start), '-t', String(seconds), '-i', inName];
    if (musName) {
      args.push('-stream_loop', '-1', '-ss', String(Math.max(0, num('musicStart', 0))), '-i', musName);
    }
    let vchain = `[0:v]${vf}[v]`;
    if (textName) {
      args.push('-i', textName);
      const pos = $('textPos').value;
      const y = pos === 'atas' ? 'H*0.08' : pos === 'tengah' ? '(H-h)/2' : 'H-h-H*0.12';
      vchain = `[0:v]${vf}[base];[base][${musName ? 2 : 1}:v]overlay=(W-w)/2:${y}[v]`;
    }
    args.push('-filter_complex', vchain + af, '-map', '[v]');
    args.push(...(af ? ['-map', '[a]'] : ['-an']));
    args.push(...encodeArgs(q, seconds, ['-fpsmax', '30']));

    setStatus('Memproses… 0%', 5);
    const code = await run(f, args, seconds);
    if (code !== 0) throw ffmpegError();
    return await readOutput(f);
  } finally {
    await cleanup(f, [inName, musName, textName, 'subs.ass', 'out.mp4'].filter(Boolean));
  }
}

function ffmpegError() {
  const tail = logTail.filter((l) => l.trim()).slice(-4).join('\n');
  return new Error('Gagal memproses file ini.\n' + tail);
}

async function readOutput(f) {
  const data = await f.readFile('out.mp4');
  if (!data || !data.length) throw new Error('Hasil kosong. Coba file lain.');
  return new File([data], outName('mp4'), { type: 'video/mp4' });
}

function outName(ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `StoryHD_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

async function onProcess() {
  if (state.busy || !state.media) return;
  state.busy = true;
  showError('');
  $('processBtn').disabled = true;
  $('progressWrap').hidden = false;
  $('resultCard').hidden = true;
  setStatus('Mulai…', 0);
  try {
    let file;
    if (state.kind === 'video') file = await processVideo();
    else if (state.music) file = await processPhotoWithMusic();
    else file = await processPhotoOnly();
    showResult(file);
    setStatus('Selesai.', 100);
  } catch (err) {
    console.error(err);
    showError(err && err.message ? err.message : String(err));
    setStatus('', 0);
    $('progressWrap').hidden = true;
  } finally {
    state.busy = false;
    $('processBtn').disabled = false;
  }
}

/* ---------- result / sharing ---------- */

function showResult(file) {
  if (state.outUrl) URL.revokeObjectURL(state.outUrl);
  state.outFile = file;
  state.outUrl = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video');
  $('outImg').hidden = isVideo;
  $('outVid').hidden = !isVideo;
  (isVideo ? $('outVid') : $('outImg')).src = state.outUrl;
  $('outInfo').textContent = `${file.name} · ${fmtSize(file.size)}` +
    (file.size > 16 * 1048576 ? ' · di atas 16 MB, WhatsApp mungkin mengompres ulang' : '');
  $('downloadBtn').href = state.outUrl;
  $('downloadBtn').download = file.name;
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  $('shareBtn').hidden = !canShare;
  $('shareHint').hidden = canShare;
  $('resultCard').hidden = false;
  $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function onShare() {
  if (!state.outFile) return;
  const text = captionText();
  const data = { files: [state.outFile] };
  let note = 'Pilih WhatsApp, lalu Status Saya.';
  if (text) {
    // WhatsApp sometimes drops the text of a file share, so keep a copy ready to paste.
    try {
      await navigator.clipboard.writeText(text);
      note += ' Teks status sudah disalin: tempel jika tidak muncul otomatis.';
    } catch (_) { /* clipboard unavailable */ }
    if (navigator.canShare({ files: data.files, text })) data.text = text;
  }
  $('shareNote').textContent = note;
  $('shareNote').hidden = false;
  try {
    await navigator.share(data);
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      showError('Tidak bisa membagikan langsung. Simpan dulu, lalu pilih dari galeri di WhatsApp.');
    }
  }
}

async function onShareTextOnly() {
  const text = captionText();
  if (!text) {
    $('caption').focus();
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

/* ---------- input handling ---------- */

function setMedia(file) {
  if (!file) return;
  const isVideo = file.type.startsWith('video');
  const isImage = file.type.startsWith('image');
  if (!isVideo && !isImage) {
    showError('Pilih file foto atau video.');
    return;
  }
  showError('');
  state.media = file;
  state.kind = isVideo ? 'video' : 'image';
  state.duration = 0;

  const img = $('imgPreview'), vid = $('vidPreview');
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  const url = URL.createObjectURL(file);
  img.dataset.url = url;
  img.hidden = isVideo;
  vid.hidden = !isVideo;
  if (isVideo) { vid.src = url; img.removeAttribute('src'); }
  else { img.src = url; vid.removeAttribute('src'); vid.load(); }

  let info = `${file.name} · ${fmtSize(file.size)}`;
  if (isVideo && file.size > 300 * 1048576) {
    info += ' · file besar, proses bisa lambat atau gagal di HP';
  }
  $('mediaInfo').textContent = info;
  $('mediaPick').textContent = 'Ganti foto / video';
  $('preview').hidden = false;
  $('settings').hidden = false;
  $('musicCard').hidden = false;
  $('actionCard').hidden = false;
  $('resultCard').hidden = true;
  $('progressWrap').hidden = true;
  $('videoOpts').hidden = !isVideo;
  $('subCard').hidden = !isVideo;
  clearSubs();
  $('start').value = 0;
  syncMusicUi();
}

function setMusic(file, credit) {
  const audio = $('musicPreview');
  state.musicCredit = (file && credit) || '';
  $('musicCredit').textContent = state.musicCredit;
  $('creditRow').hidden = !state.musicCredit;
  if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
  state.music = file || null;
  if (file) {
    audio.dataset.url = URL.createObjectURL(file);
    audio.src = audio.dataset.url;
    $('musicName').textContent = (file.type.startsWith('video') ? 'Suara dari video: ' : 'Lagu: ') +
      `${file.name} · ${fmtSize(file.size)}`;
  } else {
    audio.removeAttribute('src');
    audio.load();
    delete audio.dataset.url;
    $('musicInput').value = '';
    $('musicVidInput').value = '';
  }
  syncMusicUi();
}

function syncMusicUi() {
  $('musicOpts').hidden = !state.music;
  $('origVolRow').hidden = state.kind !== 'video';
  $('photoDurRow').hidden = state.kind !== 'image';
  $('processBtn').textContent =
    state.kind === 'image' && state.music ? 'Buat video story HD' : 'Proses jadi HD';
}

function bindRange(id) {
  const el = $(id), out = $(id + 'Out');
  const sync = () => { out.textContent = el.value + '%'; };
  el.addEventListener('input', sync);
  sync();
}

$('mediaInput').addEventListener('change', (e) => setMedia(e.target.files[0]));
['musicInput', 'musicVidInput'].forEach((id) => {
  $(id).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) setMusic(file);
  });
});
$('musicRemove').addEventListener('click', () => setMusic(null));
$('processBtn').addEventListener('click', onProcess);
$('shareBtn').addEventListener('click', onShare);
$('textOnlyBtn').addEventListener('click', onShareTextOnly);
$('burnText').addEventListener('change', () => { $('textPosRow').hidden = !$('burnText').checked; });
bindRange('musicVol');
bindRange('origVol');

$('vidPreview').addEventListener('loadedmetadata', () => {
  const d = $('vidPreview').duration;
  if (!Number.isFinite(d) || d <= 0) return;
  state.duration = d;
  $('dur').value = Math.min(60, Math.round(d * 10) / 10);
  $('dur').max = Math.ceil(d);
  $('start').max = Math.max(0, Math.floor(d - 1));
});

// Drag and drop on desktop.
const pick = $('mediaPick');
['dragenter', 'dragover'].forEach((t) => pick.addEventListener(t, (e) => {
  e.preventDefault();
  pick.classList.add('drag');
}));
['dragleave', 'drop'].forEach((t) => pick.addEventListener(t, (e) => {
  e.preventDefault();
  pick.classList.remove('drag');
}));
pick.addEventListener('drop', (e) => setMedia(e.dataTransfer.files[0]));
