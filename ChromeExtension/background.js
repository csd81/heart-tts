chrome.runtime.onInstalled.addListener(() => {
  // Creating exactly ONE item prevents Chrome from forcing a sub-menu
  chrome.contextMenus.create({
    id: "smart-read",
    title: "Read Selection / From Here",
    contexts: ["all"]
  });
});

// PDF Redirection Logic
const PDF_VIEWER = chrome.runtime.getURL('pdf-viewer.html');
const PDF_PATTERN = /^(https?:|file:).+\.pdf(\?.*)?$/i;

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url;
  if (!url || !PDF_PATTERN.test(url)) return;
  if (url.startsWith(PDF_VIEWER)) return;
  chrome.tabs.update(tabId, { url: PDF_VIEWER + '?url=' + encodeURIComponent(url) });
});

async function processAndPlay(inputData) {
  if (!inputData) return;

  let chunks = [];
  if (Array.isArray(inputData)) {
    chunks = inputData;
  } else {
    // Standardize splitting by paragraph for the server
    chunks = inputData
      .split(/\r?\n\s*\n|\n/) 
      .filter(chunk => chunk.trim().length > 0);
  }

  const settings = await chrome.storage.local.get(['selectedModel', 'selectedVoice', 'playbackSpeed']);
  const currentModel = settings.selectedModel || "piper";
  const currentVoice = settings.selectedVoice || "anna";
  const currentSpeed = settings.playbackSpeed || 1.2;

  await setupOffscreenDocument('offscreen.html');

  chrome.runtime.sendMessage({
    type: "START_STREAM",
    chunks: chunks,
    model: currentModel,
    voice: currentVoice,
    speed: currentSpeed
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "smart-read") {
    // 1. Prioritize Selection
    if (info.selectionText) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_SELECTED_TEXT" });
        if (response && response.text) {
          return await processAndPlay(response.text);
        }
      } catch (e) {
        // Content script might not be injected (e.g. on restricted pages), fallback to raw selection
        return await processAndPlay(info.selectionText);
      }
    }
    
    // 2. Fallback: Read from click position
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_TEXT_FROM_HERE" });
      if (response && response.text) {
        await processAndPlay(response.text);
      }
    } catch (e) {
      console.error("Content script unreachable:", e);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PLAY_TEXT") {
    processAndPlay(request.chunks || request.text);
  }

  if (request.type === "FORWARD_TO_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, request).catch(() => {});
      }
    });
  }
});

let creating; 
async function setupOffscreenDocument(path) {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(path)]
  });
  if (existingContexts.length > 0) return;

  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Streaming TTS',
    });
    try { await creating; } 
    finally { creating = null; }
  }
}