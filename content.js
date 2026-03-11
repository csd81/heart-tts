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
}

function highlightText(searchText) {
  clearHighlights();
  if (!searchText || !searchText.trim()) return;

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

  // window.find now searches forward from the hidden cursor
  const found = window.find(textToFind, false, false, true, false, false, false);

  if (found && selection.rangeCount > 0) {
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
    const elementCenterY = rect.top + (rect.height / 2);
    const viewportCenterY = window.innerHeight / 2;
    const scrollOffset = elementCenterY - viewportCenterY;
    
    window.scrollBy({ 
      top: scrollOffset, 
      behavior: 'smooth' 
    });
  }

  // Restore the user's original selection
  selection.removeAllRanges();
  if (originalRange) {
    selection.addRange(originalRange);
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
    ttsCursorRange = null; // NEW: Reset the tracker completely when audio stops
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
    
    if (mainContent && mainContent.innerText) {
      // NEW: Initialize the tracker at the very top of the article
      ttsCursorRange = document.createRange();
      ttsCursorRange.selectNodeContents(mainContent);
      ttsCursorRange.collapse(true);

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