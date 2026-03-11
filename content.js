let lastClickedElement = null;

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
}

function highlightText(searchText) {
  clearHighlights();
  if (!searchText || !searchText.trim()) return;

  const textToFind = searchText.trim();
  const selection = window.getSelection();
  const originalRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  
  selection.removeAllRanges();

  const found = window.find(textToFind, false, false, true, false, false, false);

  if (found && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0).cloneRange();
    
    if (typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && CSS.highlights) {
      const highlight = new Highlight(range);
      CSS.highlights.set('tts-highlight', highlight);
    } else {
      try {
        const mark = document.createElement('mark');
        mark.className = 'tts-highlight';
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
      } catch (e) {
        console.warn('Highlight wrapping failed.', e);
      }
    }

    const rect = range.getBoundingClientRect();
    const elementCenterY = rect.top + (rect.height / 2);
    const viewportCenterY = window.innerHeight / 2;
    const scrollOffset = elementCenterY - viewportCenterY;
    
    window.scrollBy({ 
      top: scrollOffset, 
      behavior: 'smooth' 
    });
  }

  selection.removeAllRanges();
  if (originalRange) {
    selection.addRange(originalRange);
  }
}

// --- Deep DOM Traversal Logic ---
// Finds the closest major structural block to prevent starting mid-sentence if the user clicked a bold word
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
    return;
  }

  // Triggered by the "READ PAGE" button in the popup
  if (request.action === "GET_FULL_PAGE_TEXT") {
    let mainContent = null;

    // 1. Hyperskill-specific logic
    if (window.location.hostname.includes("hyperskill.org")) {
      mainContent = document.querySelector('.step-text .content') || document.querySelector('.content');
    }

    // 2. Generic fallback for all other websites (or if Hyperskill elements are missing)
    if (!mainContent) {
      mainContent = document.querySelector('article') || 
                    document.querySelector('[role="main"]') || 
                    document.querySelector('main') || 
                    document.body;
    }
    
    if (mainContent && mainContent.innerText) {
      return sendResponse({ text: mainContent.innerText.trim() });
    } else {
      return sendResponse({ text: "" });
    }
  }

  // Triggered by the background script when using the right-click menu
  if (request.action === "GET_TEXT_FROM_HERE") {
    if (!lastClickedElement) {
      return sendResponse({ text: "" });
    }

    let startNode = getClosestBlockElement(lastClickedElement);
    let boundary = null;

    // 1. Hyperskill-specific boundary
    if (window.location.hostname.includes("hyperskill.org")) {
      boundary = startNode.closest('.step-text .content, .content');
    }

    // 2. Generic fallback boundary for all other websites
    if (!boundary) {
      boundary = startNode.closest('article, [role="main"], main') || document.body;
    }
    
    let fullText = "";

    if (startNode.innerText) {
      fullText += startNode.innerText + "\n\n";
    }

    let node = startNode;
    // Bubble up, but STOP when we hit the boundary
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