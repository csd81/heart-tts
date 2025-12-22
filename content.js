let lastClickedElement = null;

document.addEventListener("contextmenu", (event) => {
  lastClickedElement = event.target;
}, true);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_TEXT_FROM_HERE") {
    // Gemini-specific logic
    if (window.location.hostname.includes("gemini.google.com")) {
      // Strategy: Find the last "action" button (Copy, Share, etc) on the page.
      // This usually corresponds to the latest response.
      const triggers = document.querySelectorAll(`
        button[aria-label*="Copy"],
        button[aria-label*="Share"],
        button[aria-label*="Good response"],
        button[aria-label*="Bad response"],
        button[aria-label*="Modify"],
        button[aria-label*="Google It"]
      `);

      if (triggers.length > 0) {
        // Get the last visible button
        const lastButton = triggers[triggers.length - 1];
        const text = getTextFromButton(lastButton);
        if (text) {
          return sendResponse({ text: text });
        }
      }

      // Fallback: Try to find the last significant text block if button strategy fails
      const allDivs = document.querySelectorAll('div');
      let candidate = null;
      for (let i = allDivs.length - 1; i >= 0; i--) {
        const div = allDivs[i];
        if (div.innerText && div.innerText.length > 50 && div.offsetParent !== null) {
          if (!div.querySelector('textarea') && !div.querySelector('input')) {
            candidate = div;
            break;
          }
        }
      }
      if (candidate && (!lastClickedElement || lastClickedElement === document.body)) {
        return sendResponse({ text: candidate.innerText.trim() });
      }
    }

    if (!lastClickedElement) return sendResponse({ text: "" });

    let fullText = "";
    let current = lastClickedElement;

    // Grabs text from the clicked element and its following neighbors
    while (current) {
      if (current.innerText) {
        fullText += current.innerText + "\n";
      }
      current = current.nextElementSibling;
    }

    sendResponse({ text: fullText.trim() });
  }
});

// --- Dynamic Button Injection for Gemini ---

const SPEAKER_SVG = `
<svg viewBox="0 0 24 24">
  <path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77zm-4 0h-2.5l-5 5H2v7h.5l5 5H10V3.23zm2 15.29L7.55 14H4V10h3.55l4.45-4.52v13.04z"/>
</svg>`;

function injectReadButtons() {
  if (!window.location.hostname.includes("gemini.google.com")) return;

  const triggers = document.querySelectorAll(`
    button[aria-label*="Copy"],
    button[aria-label*="Share"],
    button[aria-label*="Good response"],
    button[aria-label*="Bad response"],
    button[aria-label*="Modify"],
    button[aria-label*="Google It"]
  `);

  triggers.forEach(trigger => {
    const parent = trigger.parentElement;
    if (!parent) return;

    if (parent.querySelector('.gemini-read-button')) return;

    const grandparent = parent.parentElement;
    if (grandparent && grandparent.querySelector('.gemini-read-button')) return;

    const readBtn = document.createElement('button');
    readBtn.className = 'gemini-read-button';
    readBtn.innerHTML = SPEAKER_SVG;
    readBtn.title = "Read Aloud";
    readBtn.type = "button";

    readBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleReadButton(e.target);
    });

    parent.insertBefore(readBtn, parent.firstChild);
  });
}

function handleReadButton(target) {
  const btn = target.closest('button');
  if (!btn) return;

  // We need to look adjacent to the *injected* button, which is now a sibling of the 'Copy' button etc.
  // So 'btn' is our read button.
  // But our getTextFromButton logic assumes we are starting from a native action button (like copy).
  // Luckily, our button is inserted right next to them. 
  // So we can use the existing logic or traverse slightly differently.

  const text = getTextFromButton(btn);
  if (text) {
    triggerRead(text);
  } else {
    console.warn("Could not find text for this button");
  }
}

function getTextFromButton(button) {
  // 1. Try finding container by known classes
  let container = button.closest('.model-response-text');

  if (container && container.innerText) {
    return container.innerText.trim();
  }

  // 2. Traverse up and look for known message containers
  let parent = button.parentElement;
  for (let i = 0; i < 15; i++) {
    if (!parent) break;

    // A. Check if this parent IS a message container (has data attribute)
    if (parent.hasAttribute('data-message-author-role') && parent.getAttribute('data-message-author-role') === 'model') {
      if (parent.innerText && parent.innerText.trim().length > 0) {
        return parent.innerText.trim();
      }
    }

    // B. Check for children with known classes
    const candidates = parent.querySelectorAll('.model-response-text, [data-message-author-role="model"]');
    for (const candidate of candidates) {
      // Ensure the candidate is substantial and likely the one we want
      // Avoid selecting the button's own tooltip or something small
      if (candidate.innerText && candidate.innerText.trim().length > 20) {
        return candidate.innerText.trim();
      }
    }

    // C. Heuristic: Look for the largest sibling paragraph/div that isn't the toolbar itself
    //    The toolbar is likely where our button is. The text is usually a sibling of the toolbar wrapper.
    //    or the toolbar is in the footer, and text is in `model-response-text` above it.

    // If we are deep in the structure, the text might be in a previous sibling of a designated ancestor.

    parent = parent.parentElement;
  }

  return null;
}

function triggerRead(text) {
  chrome.runtime.sendMessage({
    action: "PLAY_TEXT",
    text: text
  });
}

// --- Auto-Play Logic ---

function markInitialResponsesAsPlayed() {
  if (!window.location.hostname.includes("gemini.google.com")) return;

  const triggers = document.querySelectorAll(`
    button[aria-label*="Copy"],
    button[aria-label*="Share"],
    button[aria-label*="Good response"],
    button[aria-label*="Bad response"],
    button[aria-label*="Modify"],
    button[aria-label*="Google It"]
  `);

  triggers.forEach(trigger => {
    const parent = trigger.parentElement;
    if (parent) {
      parent.dataset.geminiAutoPlayed = "true";
    }
  });
}

const STABILITY_CHECK_INTERVAL = 500;
const STABILITY_THRESHOLD = 4; // 2 seconds of stability

function isGenerating() {
  // Check for the "Stop response" or "Stop generating" button which indicates generation is in progress.
  // This serves as a proxy for the "spinning Gemini sign".
  return !!document.querySelector('button[aria-label*="Stop response"], button[aria-label*="Stop generating"]');
}

function waitForStabilityAndPlay(trigger, parent) {
  let lastText = "";
  let stableCount = 0;

  // Safety: Stop checking after a maximum time (e.g., 2 minutes) to prevent memory leaks
  let checks = 0;
  const MAX_CHECKS = (120 * 1000) / STABILITY_CHECK_INTERVAL;

  const intervalId = setInterval(() => {
    checks++;
    if (checks > MAX_CHECKS) {
      clearInterval(intervalId);
      parent.dataset.geminiWaiting = "false"; // Reset so we retry if needed
      return;
    }

    // Step 0: strictly wait if Gemini is still generating
    if (isGenerating()) {
      stableCount = 0;
      // We keep lastText updated so we don't treat the static text immediately after stop as "newly stable"
      // if it hasn't changed since the last check. 
      // Actually, we want to start counting stability *after* generation stops.
      const text = getTextFromButton(trigger);
      if (text) lastText = text;
      return;
    }

    const currentText = getTextFromButton(trigger);

    // If we can't find text, it might be loading. 
    // If we had text and lost it, something is wrong.
    if (!currentText) {
      // Reset stable count if we lose text, but don't abort immediately
      stableCount = 0;
      return;
    }

    if (currentText.length > lastText.length) {
      lastText = currentText;
      stableCount = 0;
      // console.log("Text growing...", currentText.length);
    } else {
      // Text length hasn't increased
      stableCount++;
      // console.log("Text stable...", stableCount);
    }

    if (stableCount >= STABILITY_THRESHOLD) {
      clearInterval(intervalId);

      // Mark as played
      parent.dataset.geminiAutoPlayed = "true";
      // Remove waiting status
      delete parent.dataset.geminiWaiting;

      triggerRead(currentText);
    }
  }, STABILITY_CHECK_INTERVAL);
}

function handleAutoPlay() {
  if (!window.location.hostname.includes("gemini.google.com")) return;

  const triggers = document.querySelectorAll(`
    button[aria-label*="Copy"],
    button[aria-label*="Share"],
    button[aria-label*="Good response"],
    button[aria-label*="Bad response"],
    button[aria-label*="Modify"],
    button[aria-label*="Google It"]
  `);

  if (triggers.length === 0) return;

  // Check the very last button (latest response)
  const lastTrigger = triggers[triggers.length - 1];
  const parent = lastTrigger.parentElement;

  if (parent) {
    // If not played AND not currently waiting for stability
    if (parent.dataset.geminiAutoPlayed !== "true" && parent.dataset.geminiWaiting !== "true") {
      // Found a new, unplayed response
      // console.log("New response detected, waiting for stability...");
      parent.dataset.geminiWaiting = "true";
      waitForStabilityAndPlay(lastTrigger, parent);
    }
  }
}

// Start Observer
const observer = new MutationObserver((mutations) => {
  injectReadButtons();
  handleAutoPlay();
});

// We need to wait for body
if (document.body) {
  markInitialResponsesAsPlayed(); // Mark existing ones as played so we don't auto-play them on reload
  observer.observe(document.body, { childList: true, subtree: true });
  injectReadButtons();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    markInitialResponsesAsPlayed();
    observer.observe(document.body, { childList: true, subtree: true });
    injectReadButtons();
  });
}