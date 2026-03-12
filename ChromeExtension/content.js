let lastClickedElement = null;
let ttsCursorRange = null; // NEW: Tracks the reader's current position in the DOM

// --- Highlighting & Scrolling Logic ---
function clearHighlights() {
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    CSS.highlights.clear();
  }
  
  document.querySelectorAll('mark.tts-highlight').forEach(mark => {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  });

  // clear fallback highlights for blocks
  document.querySelectorAll('.tts-highlight-fallback').forEach(el => {
    el.classList.remove('tts-highlight-fallback');
    el.style.backgroundColor = '';
  });
}

function highlightText(searchText) {
  clearHighlights();
  if (!searchText || !searchText.trim()) return;

  // Since tables and pre blocks are sent as chunks, finding them exactly via window.find() often fails
  // due to invisible newlines or whitespace. We map the chunks back to the DOM nodes.
  
  // Find the exact node that corresponds to this chunk text
  let targetBlock = null;
  const blocks = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, pre, table'));
  
  // Start searching from the last tracked index, or 0 if none
  let startIndex = window.lastMatchedBlockIndex || 0;
  
  for (let i = startIndex; i < blocks.length; i++) {
    let block = blocks[i];
    if (block.offsetParent === null) continue;
    if (block.tagName === 'LI' && block.querySelector('p, h1, h2, h3, h4, h5, h6, pre, table')) continue;
    if (block.tagName !== 'TABLE' && block.closest('table')) continue;
    if (block.tagName !== 'PRE' && block.closest('pre')) continue;

    if (block.innerText && block.innerText.trim() === searchText.trim()) {
      targetBlock = block;
      window.lastMatchedBlockIndex = i + 1; // Save index to resume from next time
      break;
    }
  }

  // If we couldn't find it going forward (maybe the user rewound/went backwards),
  // fallback to searching from the beginning
  if (!targetBlock) {
    for (let i = 0; i < startIndex; i++) {
      let block = blocks[i];
      if (block.offsetParent === null) continue;
      if (block.tagName === 'LI' && block.querySelector('p, h1, h2, h3, h4, h5, h6, pre, table')) continue;
      if (block.tagName !== 'TABLE' && block.closest('table')) continue;
      if (block.tagName !== 'PRE' && block.closest('pre')) continue;
  
      if (block.innerText && block.innerText.trim() === searchText.trim()) {
        targetBlock = block;
        window.lastMatchedBlockIndex = i + 1;
        break;
      }
    }
  }

  if (targetBlock) {
    const range = document.createRange();
    range.selectNodeContents(targetBlock);
    
    // Attempt non-destructive CSS Highlight API (Chrome 105+)
    if (typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && CSS.highlights) {
      const highlight = new Highlight(range);
      CSS.highlights.set('tts-highlight', highlight);
    } else {
      // Fallback
      targetBlock.classList.add('tts-highlight-fallback');
      targetBlock.style.backgroundColor = 'rgba(255, 255, 0, 0.4)';
    }

    // Always smoothly scroll to keep the text in the vertical center of the screen
    targetBlock.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    // If the exact block match fails, try window.find (good for standard paragraphs)
    const textToFind = searchText.trim();
    const selection = window.getSelection();
    
    // Save user's current selection so we don't annoy them
    const originalRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    
    selection.removeAllRanges();

    // NEW: If we have a tracked position, start searching FORWARD from there
    if (ttsCursorRange) {
      const searchStartRange = ttsCursorRange.cloneRange();
      searchStartRange.collapse(false); // Move to the end of the last highlighted sentence
      selection.addRange(searchStartRange);
    }

    // Save original scroll so we eliminate jump
    const oldScrollX = window.scrollX;
    const oldScrollY = window.scrollY;

    // window.find now searches forward from the hidden cursor
    const found = window.find(textToFind, false, false, true, false, false, false);

    if (found && selection.rangeCount > 0) {
      window.scrollTo(oldScrollX, oldScrollY); // Revert the instant scroll from window.find
      const range = selection.getRangeAt(0).cloneRange();
      
      // NEW: Save this new position as the starting point for the next sentence
      ttsCursorRange = range.cloneRange();
      
      // Attempt non-destructive CSS Highlight API (Chrome 105+)
      if (typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && CSS.highlights) {
        const highlight = new Highlight(range);
        CSS.highlights.set('tts-highlight', highlight);
      } else {
        // Fallback: Wrap in a <mark> tag
        try {
          const mark = document.createElement('mark');
          mark.className = 'tts-highlight';
          mark.appendChild(range.extractContents());
          range.insertNode(mark);
        } catch (e) {
          console.warn('Highlight wrapping failed.', e);
        }
      }

      // Always smoothly scroll to keep the text in the vertical center of the screen
      const rect = range.getBoundingClientRect();
      const absoluteTop = rect.top + window.scrollY;
      const elementCenterY = absoluteTop + (rect.height / 2);
      const viewportCenterY = window.innerHeight / 2;
      
      window.scrollTo({ 
        top: elementCenterY - viewportCenterY, 
        behavior: 'smooth' 
      });
    }

    // Restore the user's original selection
    selection.removeAllRanges();
    if (originalRange) {
      selection.addRange(originalRange);
    }
  }
}

// --- Deep DOM Traversal Logic ---
function getClosestBlockElement(el) {
  const blockTags = ['P', 'DIV', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'ARTICLE', 'SECTION', 'MAIN', 'BLOCKQUOTE', 'PRE'];
  let current = el;
  while (current && current !== document.body) {
    if (blockTags.includes(current.tagName)) {
      return current;
    }
    current = current.parentElement;
  }
  return el; 
}

// --- Listeners ---
document.addEventListener("contextmenu", (event) => {
  lastClickedElement = event.target;
}, true);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "HIGHLIGHT_TEXT") {
    highlightText(request.text);
    return;
  } 
  
  if (request.action === "CLEAR_HIGHLIGHT") {
    clearHighlights();
    ttsCursorRange = null; // Reset the tracker completely when audio stops
    window.lastMatchedBlockIndex = 0; // Reset block tracker
    return;
  }

  // Triggered by the "READ PAGE" button in the popup
  if (request.action === "GET_FULL_PAGE_TEXT") {
    let mainContent = null;

    if (window.location.hostname.includes("hyperskill.org")) {
      mainContent = document.querySelector('.step-text .content') || document.querySelector('.content');
    }

    if (!mainContent) {
      mainContent = document.querySelector('article') || 
                    document.querySelector('[role="main"]') || 
                    document.querySelector('main') || 
                    document.body;
    }
    
    if (mainContent) {
      // NEW: Initialize the tracker at the very top of the article
      ttsCursorRange = document.createRange();
      ttsCursorRange.selectNodeContents(mainContent);
      ttsCursorRange.collapse(true);

      const chunks = [];
      const blocks = mainContent.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, pre, table');
      
      blocks.forEach(block => {
        // Skip elements that are hidden
        if (block.offsetParent === null) return;
        
        // Skip list items that are just containers for other blocks we already extracted
        if (block.tagName === 'LI' && block.querySelector('p, h1, h2, h3, h4, h5, h6, pre, table')) return;

        // Skip any block that is inside a table or pre (except the table or pre itself)
        if (block.tagName !== 'TABLE' && block.closest('table')) return;
        if (block.tagName !== 'PRE' && block.closest('pre')) return;

        let text = block.innerText;
        if (text && text.trim()) {
           chunks.push(text.trim());
        }
      });

      // If the page embeds content in an iframe (e.g. MathWorks Quick Reference),
      // try reading text from same-origin iframes before giving up.
      if (chunks.length === 0) {
        try {
          const iframes = document.querySelectorAll('iframe');
          for (const iframe of iframes) {
            const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!iDoc) continue;
            const iMain = iDoc.querySelector('article, [role="main"], main') || iDoc.body;
            if (!iMain) continue;

            // Initialize the TTS cursor inside the iframe's content
            ttsCursorRange = document.createRange();
            ttsCursorRange.selectNodeContents(iMain);
            ttsCursorRange.collapse(true);

            const iBlocks = iMain.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, pre, table');
            iBlocks.forEach(block => {
              if (block.offsetParent === null) return;
              if (block.tagName === 'LI' && block.querySelector('p, h1, h2, h3, h4, h5, h6, pre, table')) return;
              if (block.tagName !== 'TABLE' && block.closest('table')) return;
              if (block.tagName !== 'PRE' && block.closest('pre')) return;
              const text = block.innerText;
              if (text && text.trim()) chunks.push(text.trim());
            });

            if (chunks.length > 0) break; // Stop after first iframe that yields content
          }
        } catch (e) {
          // Cross-origin iframes will throw — that's expected, just skip them
        }
      }

      // If we couldn't find blocks for some reason, fallback to innerText split by newlines
      if (chunks.length === 0 && mainContent.innerText) {
         return sendResponse({ chunks: mainContent.innerText.trim().split(/\r?\n\s*\n|\n/).filter(c => c.trim().length > 0) });
      }

      return sendResponse({ chunks: chunks });
    } else {
      return sendResponse({ chunks: [] });
    }
  }

  // Triggered by the background script when using the right-click menu
  if (request.action === "GET_TEXT_FROM_HERE") {
    if (!lastClickedElement) {
      return sendResponse({ text: "" });
    }

    let startNode = getClosestBlockElement(lastClickedElement);
    let boundary = null;

    if (window.location.hostname.includes("hyperskill.org")) {
      boundary = startNode.closest('.step-text .content, .content');
    }

    if (!boundary) {
      boundary = startNode.closest('article, [role="main"], main') || document.body;
    }

    // NEW: Initialize the tracker exactly where the user clicked
    ttsCursorRange = document.createRange();
    ttsCursorRange.selectNodeContents(startNode);
    ttsCursorRange.collapse(true);
    
    let fullText = "";

    if (startNode.innerText) {
      fullText += startNode.innerText + "\n\n";
    }

    let node = startNode;
    while (node && node !== boundary && node !== document.body) {
      let sibling = node.nextElementSibling;
      
      while (sibling) {
        if (sibling.innerText && sibling.offsetParent !== null) {
          fullText += sibling.innerText + "\n\n";
        }
        sibling = sibling.nextElementSibling;
      }
      
      node = node.parentElement;
    }

    sendResponse({ text: fullText.trim() });
  }
});