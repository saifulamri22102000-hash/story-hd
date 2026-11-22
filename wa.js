'use strict';
// WhatsApp Status settings UI and the "3 test versions" helper.

const WA_HINTS = {
  aman: 'Mendekati ukuran yang dipakai WhatsApp sendiri, jadi kompresi ulangnya paling sedikit mengubah video.',
  ringan: 'Bitrate rendah. Lebih kecil peluang dikompres berat, tapi detail halus sedikit berkurang.',
  maks: 'File sebesar mungkin (≤16 MB). Bagus untuk disimpan atau dikirim sebagai dokumen; di Status tetap dikompres WhatsApp.',
  manual: 'Atur sendiri. Coba dengan “Buat 3 versi uji” untuk membandingkan.',
};
const TEST_SET = [
  ['aman', 'A_aman_2Mbps'],
  ['ringan', 'B_antikompres_1.2Mbps'],
  ['maks', 'C_maksimal'],
];

function syncWaUi() {
  const id = $('waProfile').value;
  $('manualOpts').hidden = id !== 'manual';
  $('qualityRow').hidden = id !== 'maks';
  $('qualityHint').hidden = id !== 'maks';
  $('waHint').textContent = WA_HINTS[id] || '';
  $('mKbpsOut').textContent = $('mKbps').value + ' kbps';
}

function syncTestBtn() {
  $('testBtn').hidden = state.kind !== 'video';
}

async function makeTestVersions() {
  if (state.busy || state.kind !== 'video') return;
  const saved = { profile: $('waProfile').value, dur: $('dur').value };
  const files = [];
  state.busy = true;
  $('processBtn').disabled = true;
  $('testBtn').disabled = true;
  showError('');
  $('progressWrap').hidden = false;
  $('testCard').hidden = true;
  try {
    $('dur').value = Math.min(5, num('dur', 5));
    for (let i = 0; i < TEST_SET.length; i++) {
      const [id, label] = TEST_SET[i];
      $('waProfile').value = id;
      setStatus(`Membuat versi uji ${i + 1} dari ${TEST_SET.length}…`, (i / TEST_SET.length) * 100);
      const out = await processVideo();
      files.push(new File([out], `StoryHD_uji_${label}.mp4`, { type: 'video/mp4' }));
    }
    setStatus('Versi uji siap.', 100);
    showTests(files);
  } catch (err) {
    console.error(err);
    showError(err && err.message ? err.message : String(err));
    $('progressWrap').hidden = true;
  } finally {
    $('waProfile').value = saved.profile;
    $('dur').value = saved.dur;
    syncWaUi();
    state.busy = false;
    $('processBtn').disabled = false;
    $('testBtn').disabled = false;
  }
}

let testUrls = [];

function showTests(files) {
  testUrls.forEach((u) => URL.revokeObjectURL(u));
  testUrls = [];
  const list = $('testList');
  list.textContent = '';
  files.forEach((file) => {
    const url = URL.createObjectURL(file);
    testUrls.push(url);
    const row = el('div', 'trend-row song-row');
    const info = el('div');
    info.appendChild(el('div', 't', file.name.replace(/^StoryHD_uji_|\.mp4$/g, '').replace(/_/g, ' ')));
    info.appendChild(el('div', 'a', fmtSize(file.size)));
    row.appendChild(el('span', 'rank', '🎬'));
    row.appendChild(info);
    const acts = el('div', 'acts');
    const save = el('a', 'chip', '💾 Simpan');
    save.href = url;
    save.download = file.name;
    acts.appendChild(save);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      const share = el('button', 'chip on', 'Kirim ke WhatsApp');
      share.type = 'button';
      share.addEventListener('click', () => navigator.share({ files: [file] }).catch(() => {}));
      acts.appendChild(share);
    }
    row.appendChild(acts);
    list.appendChild(row);
  });
  const all = $('testShareAll');
  all.hidden = !(navigator.canShare && navigator.canShare({ files }));
  all.onclick = () => navigator.share({ files }).catch(() => {});
  $('testCard').hidden = false;
  $('testCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('waProfile').addEventListener('change', syncWaUi);
$('mKbps').addEventListener('input', syncWaUi);
$('testBtn').addEventListener('click', makeTestVersions);
new MutationObserver(syncTestBtn).observe($('videoOpts'), { attributes: true, attributeFilter: ['hidden'] });
syncWaUi();
syncTestBtn();
