/**
 * popup.js
 * Main controller for CompressKit popup.
 * Connects UI → CompressionEngine / DecompressionEngine → MetricsEngine → HashEngine
 */

(() => {
  // ─── STATE ──────────────────────────────────────────────────────────────────
  let currentFile    = null;
  let currentMode    = 'compress';   // 'compress' | 'decompress'
  let outputData     = null;
  let outputFilename = null;
  let outputMime     = null;
  let sessionHistory = [];           // newest first, max 8 entries

  // ─── HELPERS ────────────────────────────────────────────────────────────────

  /** Reliably get byte length from ArrayBuffer, Uint8Array, or TypedArray */
  function byteLength(data) {
    if (!data) return 0;
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data))    return data.byteLength;
    return 0;
  }

  /** Yield to paint loop so progress bar updates are visible */
  function tick() { return new Promise(r => setTimeout(r, 30)); }
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  const FILE_ICONS = {
    txt: '📝', text: '📝',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️',
    wav: '🎵', mp3: '🎵',
    mp4: '🎬', mov: '🎬',
    gz: '📦', ck: '📦',
  };
  function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    return FILE_ICONS[ext] || '📄';
  }

  // ─── DOM REFS ────────────────────────────────────────────────────────────────
  const fileInput        = document.getElementById('file-input');
  const dropZone         = document.getElementById('drop-zone');
  const dropContent      = document.getElementById('drop-content');
  const fileSelected     = document.getElementById('file-selected');
  const fileNameEl       = document.getElementById('file-name');
  const fileSizeEl       = document.getElementById('file-size');
  const fileIconEl       = document.getElementById('file-icon');
  const clearBtn         = document.getElementById('clear-btn');
  const btnCompress      = document.getElementById('btn-compress');
  const btnDecompress    = document.getElementById('btn-decompress');
  const jpegQualityRow   = document.getElementById('jpeg-quality-row');
  const mp4BitrateRow    = document.getElementById('mp4-bitrate-row');
  const jpegQualityEl    = document.getElementById('jpeg-quality');
  const jpegQualityVal   = document.getElementById('jpeg-quality-val');
  const mp4BitrateEl     = document.getElementById('mp4-bitrate');
  const mp4BitrateVal    = document.getElementById('mp4-bitrate-val');
  const actionBtn        = document.getElementById('action-btn');
  const actionText       = document.getElementById('action-text');
  const progressWrap     = document.getElementById('progress-wrap');
  const progressBar      = document.getElementById('progress-bar');
  const progressLabel    = document.getElementById('progress-label');
  const resultsEl        = document.getElementById('results');
  const resultsBadge     = document.getElementById('results-badge');
  const metricOriginal   = document.getElementById('metric-original');
  const metricCompressed = document.getElementById('metric-compressed');
  const metricRatio      = document.getElementById('metric-ratio');
  const metricSavings    = document.getElementById('metric-savings');
  const hashRow          = document.getElementById('hash-row');
  const hashVal          = document.getElementById('hash-val');
  const hashStatus       = document.getElementById('hash-status');
  const qualityNote      = document.getElementById('quality-note');
  const qualityText      = document.getElementById('quality-text');
  const algoVal          = document.getElementById('algo-val');
  const algoType         = document.getElementById('algo-type');
  const downloadBtn      = document.getElementById('download-btn');
  const historySection   = document.getElementById('history-section');
  const historyList      = document.getElementById('history-list');
  const historyClearBtn  = document.getElementById('history-clear-btn');

  // ─── PROGRESS ────────────────────────────────────────────────────────────────

  function setProgress(pct, label) {
    progressBar.style.width = pct + '%';
    progressLabel.textContent = label;
  }

  function setLoading(loading) {
    actionBtn.disabled = loading;
    actionBtn.classList.toggle('loading', loading);
    progressWrap.style.display = loading ? 'block' : 'none';
    if (loading) setProgress(10, 'Initialising…');
  }

  // ─── FILE SELECTION ──────────────────────────────────────────────────────────

  function handleFile(file) {
    currentFile    = file;
    outputData     = null;
    outputFilename = null;

    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = MetricsEngine.formatBytes(file.size);
    fileIconEl.textContent = getFileIcon(file.name);

    dropContent.style.display  = 'none';
    fileSelected.style.display = 'flex';
    resultsEl.style.display    = 'none';

    const ext    = file.name.split('.').pop().toLowerCase();
    const isJpeg = ext === 'jpg' || ext === 'jpeg';
    const isMp4  = ext === 'mp4';

    jpegQualityRow.style.display = (isJpeg && currentMode === 'compress') ? 'flex' : 'none';
    mp4BitrateRow.style.display  = (isMp4  && currentMode === 'compress') ? 'flex' : 'none';

    actionBtn.disabled     = false;
    actionText.textContent = currentMode === 'compress'
      ? `Compress "${file.name}"`
      : `Decompress "${file.name}"`;
  }

  function clearFile() {
    currentFile    = null;
    outputData     = null;
    fileInput.value = '';
    dropContent.style.display    = 'flex';
    fileSelected.style.display   = 'none';
    resultsEl.style.display      = 'none';
    progressWrap.style.display   = 'none';
    jpegQualityRow.style.display = 'none';
    mp4BitrateRow.style.display  = 'none';
    actionBtn.disabled           = true;
    actionText.textContent       = 'Select a file first';
  }

  // ─── MODE TOGGLE ─────────────────────────────────────────────────────────────

  function setMode(mode) {
    currentMode = mode;
    btnCompress.classList.toggle('active',   mode === 'compress');
    btnDecompress.classList.toggle('active', mode === 'decompress');
    resultsEl.style.display = 'none';
    if (currentFile) handleFile(currentFile);
  }

  // ─── SESSION HISTORY ─────────────────────────────────────────────────────────

  function pushHistory(entry) {
    sessionHistory.unshift(entry);
    if (sessionHistory.length > 8) sessionHistory.pop();
    renderHistory();
  }

  function renderHistory() {
    if (!sessionHistory.length) {
      historySection.style.display = 'none';
      return;
    }
    historySection.style.display = 'block';
    historyList.innerHTML = '';

    sessionHistory.forEach(h => {
      const savings    = parseFloat(h.savings);
      const savingsSign = savings >= 0 ? '−' : '+';
      const savingsAbs  = Math.abs(savings).toFixed(1);
      const savingsCls  = savings >= 0 ? 'green' : 'red';
      const typeCls     = h.type === 'Lossless' ? 'green' : 'yellow';
      const typeAbbr    = h.type === 'Lossless' ? 'LL' : 'LY';
      const modeBadge   = h.mode === 'compress' ? '▼' : '▲';
      const shortName   = h.name.length > 19 ? h.name.slice(0, 18) + '…' : h.name;

      const row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = `
        <div class="h-icon">${getFileIcon(h.name)}</div>
        <div class="h-info">
          <span class="h-name" title="${h.name}">${shortName}</span>
          <span class="h-algo">${modeBadge} ${h.algo}</span>
        </div>
        <div class="h-stats">
          <span class="h-ratio">${h.ratio}</span>
          <span class="h-savings ${savingsCls}">${savingsSign}${savingsAbs}%</span>
          <span class="h-badge ${typeCls}">${typeAbbr}</span>
        </div>`;
      historyList.appendChild(row);
    });
  }

  // ─── DISPLAY RESULTS ─────────────────────────────────────────────────────────

  async function displayResults(result, originalSize, compressedSize) {
    const m = MetricsEngine.calculate(originalSize, compressedSize);

    metricOriginal.textContent    = m.originalFormatted;
    metricCompressed.textContent  = m.compressedFormatted;
    metricRatio.textContent       = m.ratio;
    metricSavings.textContent     = m.savings;
    algoVal.textContent           = result.algorithm || '—';
    algoType.textContent          = result.type      || '—';

    const isLossless = result.isLossless === true;
    resultsBadge.textContent = isLossless ? 'Lossless' : 'Lossy';
    resultsBadge.className   = 'results-badge ' + (isLossless ? 'lossless' : 'lossy');

    // ── Hash verification ──────────────────────────────────────────────────────
    if (isLossless && currentMode === 'compress') {
      hashRow.style.display = 'flex';
      try {
        const buf  = result.data instanceof ArrayBuffer ? result.data : result.data.buffer;
        const hash = await HashEngine.sha256(buf);
        hashVal.textContent    = HashEngine.short(hash) + '…';
        hashStatus.textContent = 'SHA-256 Stored';
        hashStatus.className   = 'hash-status verified';
        try { chrome.storage.local.set({ lastHash: hash, lastFile: currentFile.name }); } catch (_) {}
      } catch {
        hashStatus.textContent = 'Compute Error';
        hashStatus.className   = 'hash-status mismatch';
      }

    } else if (isLossless && currentMode === 'decompress') {
      hashRow.style.display = 'flex';
      try {
        const buf  = result.data instanceof ArrayBuffer ? result.data : result.data.buffer;
        const hash = await HashEngine.sha256(buf);
        hashVal.textContent = HashEngine.short(hash) + '…';

        const stored = await new Promise(res => {
          try { chrome.storage.local.get(['lastHash'], r => res(r.lastHash || null)); }
          catch { res(null); }
        });

        if (stored && stored === hash) {
          hashStatus.textContent = '✓ Verified';
          hashStatus.className   = 'hash-status verified';
        } else if (stored) {
          hashStatus.textContent = '✗ Mismatch';
          hashStatus.className   = 'hash-status mismatch';
        } else {
          hashStatus.textContent = 'No Reference';
          hashStatus.className   = 'hash-status na';
        }
      } catch {
        hashStatus.textContent = 'Verify Error';
        hashStatus.className   = 'hash-status mismatch';
      }

    } else {
      hashRow.style.display = 'none';
    }

    // ── Quality note (lossy) ───────────────────────────────────────────────────
    if (result.qualityNote) {
      qualityNote.style.display = 'flex';
      qualityText.textContent   = result.qualityNote;
    } else {
      qualityNote.style.display = 'none';
    }

    resultsEl.style.display = 'flex';

    // Push to session history
    pushHistory({
      name:    currentFile ? currentFile.name : '—',
      algo:    result.algorithm || '—',
      ratio:   m.ratio,
      savings: m.savingsRaw.toFixed(1),
      type:    result.type || '—',
      mode:    currentMode,
    });
  }

  // ─── RUN COMPRESS ────────────────────────────────────────────────────────────

  async function runCompress() {
    if (!currentFile) return;
    setLoading(true);

    try {
      setProgress(20, 'Reading file…');
      await tick();

      const options = {
        jpegQuality: parseInt(jpegQualityEl.value, 10),
        mp4Bitrate:  parseInt(mp4BitrateEl.value, 10),
      };

      setProgress(45, 'Applying algorithm…');
      await tick();

      const result  = await CompressionEngine.compress(currentFile, options);
      const outSize = byteLength(result.data);

      outputData     = result.data;
      outputMime     = result.outputMime;
      outputFilename = currentFile.name.replace(/\.[^.]+$/, '') + result.outputExt;

      setProgress(90, 'Computing metrics…');
      await tick();
      setProgress(100, 'Done!');
      await delay(220);

      setLoading(false);
      await displayResults(result, currentFile.size, outSize);

    } catch (err) {
      setLoading(false);
      showError('Compression failed', err.message);
      console.error('[compress]', err);
    }
  }

  // ─── RUN DECOMPRESS ──────────────────────────────────────────────────────────

  async function runDecompress() {
    if (!currentFile) return;
    setLoading(true);

    try {
      setProgress(25, 'Reading compressed file…');
      await tick();

      setProgress(55, 'Inflating data…');
      await tick();

      const result  = await DecompressionEngine.decompress(currentFile);
      const outSize = byteLength(result.data);

      result.type       = result.isLossy ? 'Lossy' : 'Lossless';
      result.isLossless = !result.isLossy;

      outputData     = result.data;
      outputMime     = result.outputMime;
      outputFilename = currentFile.name.replace(/\.[^.]+$/, '') + (result.outputExt || '');

      setProgress(90, 'Verifying integrity…');
      await tick();
      setProgress(100, 'Done!');
      await delay(220);

      setLoading(false);
      await displayResults(result, currentFile.size, outSize);

    } catch (err) {
      setLoading(false);
      showError('Decompression failed', err.message);
      console.error('[decompress]', err);
    }
  }

  // ─── DOWNLOAD ────────────────────────────────────────────────────────────────

  function triggerDownload() {
    if (!outputData || !outputFilename) return;

    const blobParts = outputData instanceof ArrayBuffer ? [outputData]
                    : ArrayBuffer.isView(outputData)    ? [outputData.buffer]
                    : [outputData];

    const blob = new Blob(blobParts, { type: outputMime || 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: outputFilename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  // ─── INLINE ERROR DISPLAY ────────────────────────────────────────────────────

  function showError(title, detail) {
    metricOriginal.textContent    = '—';
    metricCompressed.textContent  = '—';
    metricRatio.textContent       = 'Err';
    metricSavings.textContent     = '—';
    algoVal.textContent           = title;
    algoType.textContent          = '⚠';
    resultsBadge.textContent      = 'Error';
    resultsBadge.className        = 'results-badge lossy';
    hashRow.style.display         = 'none';
    qualityNote.style.display     = 'flex';
    qualityText.textContent       = detail || 'Unknown error.';
    resultsEl.style.display       = 'flex';
  }

  // ─── EVENT LISTENERS ─────────────────────────────────────────────────────────

  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  dropZone.addEventListener('click', e => {
    if (e.target === clearBtn || clearBtn.contains(e.target)) return;
    fileInput.click();
  });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  clearBtn.addEventListener('click', e => { e.stopPropagation(); clearFile(); });

  btnCompress.addEventListener('click',   () => setMode('compress'));
  btnDecompress.addEventListener('click', () => setMode('decompress'));

  jpegQualityEl.addEventListener('input', () => { jpegQualityVal.textContent = jpegQualityEl.value; });
  mp4BitrateEl.addEventListener('input',  () => { mp4BitrateVal.textContent  = mp4BitrateEl.value + 'k'; });

  actionBtn.addEventListener('click', () => {
    if (currentMode === 'compress') runCompress();
    else runDecompress();
  });

  downloadBtn.addEventListener('click', triggerDownload);

  if (historyClearBtn) {
    historyClearBtn.addEventListener('click', () => { sessionHistory = []; renderHistory(); });
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────────
  renderHistory();
})();
