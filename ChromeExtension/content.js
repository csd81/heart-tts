// --- AGGRESSIVE MATHJAX INJECTION ---
const injectClearSpeakConfig = document.createElement('script');
injectClearSpeakConfig.textContent = `
  (function forceClearSpeak() {
    const applyClearSpeak = () => {
      if (typeof MathJax !== 'undefined' && MathJax.config) {
        MathJax.config.options = MathJax.config.options || {};
        MathJax.config.options.a11y = MathJax.config.options.a11y || {};
        MathJax.config.options.a11y.sre = MathJax.config.options.a11y.sre || {};
        MathJax.config.options.a11y.sre.domain = 'clearspeak';
        if (MathJax.typesetClear && MathJax.typesetPromise) {
          MathJax.typesetClear();
          MathJax.typesetPromise().catch(e => console.warn('Math re-render failed:', e));
        }
      }
    };
    applyClearSpeak();
    let attempts = 0;
    const interval = setInterval(() => {
      applyClearSpeak();
      attempts++;
      if (attempts > 10) clearInterval(interval);
    }, 1000);
  })();
`;
(document.head || document.documentElement).appendChild(injectClearSpeakConfig);
injectClearSpeakConfig.remove();

let lastClickedElement = null;
let ttsCursorRange = null;

function getTextWithMath(element) {
  if (!element) return '';
  if (!element.querySelector('mjx-container, .MathJax, .MathJax_Display, math')) {
    return element.innerText || '';
  }
  const clone = element.cloneNode(true);
  clone.querySelectorAll('mjx-assistive-mml, .MathJax_SVG_Hidden, .MJX_Assistive_MathML, mjx-speech').forEach(n => n.remove());

  const mathSelectors = ['mjx-container', '.MathJax_Display', '.MathJax', 'math'];
  for (const sel of mathSelectors) {
    Array.from(clone.querySelectorAll(sel)).forEach(mathEl => {
      let speech = mathEl.getAttribute('aria-label') ||
        mathEl.getAttribute('data-semantic-speech-none') ||
        mathEl.getAttribute('alttext') ||
        (() => {
          const anno = mathEl.querySelector('annotation[encoding="application/x-tex"]');
          return anno ? anno.textContent.trim() : null;
        })();

      if (speech) {
        const replacement = document.createTextNode(' ' + speech.trim() + ' ');
        mathEl.parentNode && mathEl.parentNode.replaceChild(replacement, mathEl);
      } else {
        mathEl.parentNode && mathEl.parentNode.removeChild(mathEl);
      }
    });
  }
  return (clone.innerText || '').replace(/\s+/g, ' ').trim();
}

function clearHighlights() {
  if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.clear();
  document.querySelectorAll('mark.tts-highlight').forEach(mark => {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });
}

function highlightText(searchText) {
  clearHighlights();
  if (!searchText || !searchText.trim()) return;

  const selection = window.getSelection();
  const originalRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  selection.removeAllRanges();

  if (ttsCursorRange) {
    const r = ttsCursorRange.cloneRange();
    r.collapse(false);
    selection.addRange(r);
  }

  const found = window.find(searchText.trim(), false, false, true, false, false, false);
  if (found && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0).cloneRange();
    ttsCursorRange = range.cloneRange();
    if (typeof Highlight !== 'undefined' && CSS.highlights) {
      CSS.highlights.set('tts-highlight', new Highlight(range));
    }
    range.startContainer.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  selection.removeAllRanges();
  if (originalRange) selection.addRange(originalRange);
}

document.addEventListener("contextmenu", (e) => { lastClickedElement = e.target; }, true);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "HIGHLIGHT_TEXT") { highlightText(request.text); return; }
  if (request.action === "CLEAR_HIGHLIGHT") { clearHighlights(); ttsCursorRange = null; return; }

  if (request.action === "GET_SELECTED_TEXT") {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const container = document.createElement("div");
      for (let i = 0; i < selection.rangeCount; i++) {
        container.appendChild(selection.getRangeAt(i).cloneContents());
      }
      sendResponse({ text: getTextWithMath(container) });
    } else {
      sendResponse({ text: "" });
    }
    return true;
  }

  if (request.action === "GET_TEXT_FROM_HERE") {
    if (!lastClickedElement) return sendResponse({ text: "" });
    let current = lastClickedElement;
    let text = "";
    let limit = 20; // Only capture 20 blocks forward to prevent hanging
    while (current && current !== document.body && limit > 0) {
      const blockText = getTextWithMath(current);
      if (blockText) text += blockText + "\n\n";
      current = current.nextElementSibling || current.parentElement?.nextElementSibling;
      limit--;
    }
    sendResponse({ text: text.trim() });
    return true;
  }
  
  if (request.action === "GET_FULL_PAGE_TEXT") {
    const main = document.querySelector('article, main, [role="main"]') || document.body;
    const blocks = main.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
    const chunks = Array.from(blocks)
      .filter(b => b.offsetParent !== null)
      .map(b => getTextWithMath(b))
      .filter(t => t.length > 0);
    sendResponse({ chunks });
    return true;
  }
});