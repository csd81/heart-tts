// pdf-viewer.js — Canvas render + canvas overlay for TTS highlighting.

(function () {
  const loadingEl = document.getElementById('loading');
  const errorEl   = document.getElementById('error');
  const contentEl = document.getElementById('content');

  function showError(msg) {
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'block';
    errorEl.textContent     = '❌ ' + msg;
  }

  if (typeof pdfjsLib === 'undefined') { showError('PDF.js library failed to load.'); return; }

  const params = new URLSearchParams(window.location.search);
  const pdfUrl = params.get('url');
  if (!pdfUrl) { showError('No PDF URL provided.'); return; }

  try {
    const filename = decodeURIComponent(pdfUrl.split('/').pop().replace(/\.pdf$/i, ''));
    document.title = filename + ' – Kokoro TTS';
  } catch (_) {}

  const workerUrl = chrome.runtime.getURL('lib/pdf.worker.min.js');
  fetch(workerUrl)
    .then(r => r.blob())
    .then(blob => { pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob); loadPDF(); })
    .catch(() => { pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl; loadPDF(); });

  // TTS data
  const ttsChunks     = [];  // string — paragraph text
  const ttsChunkMeta  = [];  // { pageDiv, viewport, lines } where lines = [{x,y,w,h}] in PDF coords

  const SCALE = 1.5;

  async function loadPDF() {
    try {
      const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page        = await pdf.getPage(pageNum);
        const viewport    = page.getViewport({ scale: SCALE });
        const textContent = await page.getTextContent({ includeMarkedContent: false });

        // ── Canvas ────────────────────────────────────────────────────────────
        const canvas  = document.createElement('canvas');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        canvas.style.cssText = 'display:block; width:100%; height:auto;';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        // ── Page container ────────────────────────────────────────────────────
        const pageDiv = document.createElement('div');
        pageDiv.className = 'pdf-page';
        pageDiv.appendChild(canvas);
        contentEl.appendChild(pageDiv);

        if (pageNum < pdf.numPages) {
          contentEl.appendChild(document.createElement('div')).className = 'page-break';
        }

        // ── Group text items → lines → paragraphs ─────────────────────────────
        const items = textContent.items;

        // Group by Y into lines; track bounding box per line
        const lineMap = new Map(); // rounded-y → { text parts, x1, y_pdf, y2_pdf, x2 }
        for (const it of items) {
          if (!it.str || !it.str.trim()) continue;
          const y = Math.round(it.transform[5] / 2) * 2;
          if (!lineMap.has(y)) lineMap.set(y, { words: [], x1: Infinity, y1: it.transform[5], x2: -Infinity, y2: -Infinity });
          const line = lineMap.get(y);
          line.words.push(it.str);
          line.x1 = Math.min(line.x1, it.transform[4]);
          line.x2 = Math.max(line.x2, it.transform[4] + (it.width || 0));
          const fontSize = Math.abs(it.transform[0]) || Math.abs(it.transform[3]) || 12;
          line.y1 = Math.min(line.y1, it.transform[5]);
          line.y2 = Math.max(line.y2, it.transform[5] + fontSize);
        }

        const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a);

        let paraLines  = [];  // { x1, y1, x2, y2 } in PDF coords
        let paraWords  = [];
        let prevY      = null;

        const flushPara = () => {
          if (!paraWords.length) return;
          const text = paraWords.join(' ').trim();
          if (text) {
            ttsChunks.push(text);
            ttsChunkMeta.push({ pageDiv, viewport, lines: [...paraLines] });
          }
          paraWords = [];
          paraLines = [];
        };

        for (const y of sortedYs) {
          const line = lineMap.get(y);
          const gap  = prevY !== null ? Math.abs(prevY - y) : 0;
          if (prevY !== null && gap > 20) flushPara();
          paraWords.push(...line.words);
          paraLines.push({ x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 });
          prevY = y;
        }
        flushPara();
      }

      if (ttsChunks.length === 0) {
        contentEl.innerHTML = '<p style="color:#888;padding:24px">⚠️ No text extracted — may be a scanned image PDF.</p>';
      }

    } catch (err) {
      showError('Failed to load PDF: ' + err.message);
      console.error('PDF.js error:', err);
    }
  }

  // ─── TTS Highlighting ─────────────────────────────────────────────────────

  let currentOverlay = null;

  function clearHighlights() {
    if (currentOverlay) { currentOverlay.remove(); currentOverlay = null; }
  }

  function highlightChunk(searchText) {
    clearHighlights();
    if (!searchText || !searchText.trim()) return;

    const idx = ttsChunks.findIndex(t => t.trim() === searchText.trim());
    if (idx === -1) return;

    const { pageDiv, viewport, lines } = ttsChunkMeta[idx];

    // Create an overlay canvas at full PDF pixel resolution
    const overlay = document.createElement('canvas');
    overlay.width  = viewport.width;
    overlay.height = viewport.height;
    overlay.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: auto;
      pointer-events: none;
    `;

    const ctx = overlay.getContext('2d');
    ctx.fillStyle = 'rgba(255, 210, 0, 0.45)';

    for (const line of lines) {
      // Convert PDF coords → viewport (canvas pixel) coords
      // viewport.convertToViewportPoint handles the PDF y-axis flip
      const [vx1, vy1] = viewport.convertToViewportPoint(line.x1, line.y2); // top-left
      const [vx2, vy2] = viewport.convertToViewportPoint(line.x2, line.y1); // bottom-right
      const x = Math.min(vx1, vx2) - 1;
      const y = Math.min(vy1, vy2) - 1;
      const w = Math.abs(vx2 - vx1) + 2;
      const h = Math.abs(vy2 - vy1) + 2;
      ctx.fillRect(x, y, w, h);
    }

    pageDiv.appendChild(overlay);
    currentOverlay = overlay;

    // Scroll to the highlight position — NOT the whole page.
    // The canvas is CSS-scaled to 100% width; compute the scale factor.
    const cssScale = pageDiv.offsetWidth / viewport.width;
    // Get the canvas-pixel Y of the first highlighted line's top edge
    const firstLineTopPx = Math.min(...lines.map(l => {
      const [, vy] = viewport.convertToViewportPoint(l.x1, l.y2);
      return vy;
    }));
    // Convert to CSS pixels within pageDiv
    const anchorCSSY = firstLineTopPx * cssScale;

    // Place a tiny invisible anchor at that Y and scrollIntoView it
    const anchor = document.createElement('div');
    anchor.style.cssText = `position:absolute; top:${anchorCSSY}px; left:0; width:1px; height:1px; pointer-events:none;`;
    pageDiv.appendChild(anchor);
    anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => anchor.remove(), 1500);

  }

  // ─── TTS Message Listeners ────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_FULL_PAGE_TEXT') {
      sendResponse({ chunks: ttsChunks.filter(t => t.trim().length > 0) });
      return;
    }
    if (request.action === 'HIGHLIGHT_TEXT') { highlightChunk(request.text); return; }
    if (request.action === 'CLEAR_HIGHLIGHT') { clearHighlights(); return; }
  });

})();
