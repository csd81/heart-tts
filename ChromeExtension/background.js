chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "read-from-here",
    title: "Read from here",
    contexts: ["all"]
  });
});

async function processAndPlay(inputData) {
  if (!inputData) return;

  let chunks = [];
  if (Array.isArray(inputData)) {
    chunks = inputData;
  } else {
    // Fallback if we get raw text (from right-click menu)
    chunks = inputData
      .split(/\r?\n\s*\n|\n/) // Split by blank lines or newlines
      .filter(chunk => chunk.trim().length > 0); // Ignore empty strings
  }

// Pull the model, voice, and speed from storage
  const settings = await chrome.storage.local.get(['selectedModel', 'selectedVoice', 'playbackSpeed']);
  const currentModel = settings.selectedModel || "supertonic";
  const currentVoice = settings.selectedVoice || "Sarah";
  const currentSpeed = settings.playbackSpeed || 1.0;

  await setupOffscreenDocument('offscreen.html');

  // Add the 'model' to the outgoing stream payload
  chrome.runtime.sendMessage({
    type: "START_STREAM",
    chunks: chunks,
    model: currentModel,
    voice: currentVoice,
    speed: currentSpeed
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "read-from-here") {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_TEXT_FROM_HERE" });
    if (response && response.text) {
      await processAndPlay(response.text);
    }
  }
});

// Listen for direct requests from content script (Button click) or offscreen doc
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PLAY_TEXT") {
    if (request.chunks) {
      processAndPlay(request.chunks);
    } else if (request.text) {
      processAndPlay(request.text);
    }
  }

  // NEW: Forward highlight commands from offscreen doc to the active tab
  if (request.type === "FORWARD_TO_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: request.action,
          text: request.text
        }).catch(() => {}); // Ignore errors if the tab is closed/loading
      }
    });
  }
});

const MAX_OFFSCREEN_TRIES = 3;
let creating; // A global promise to avoid concurrency issues

async function setupOffscreenDocument(path) {
  // Check existing contexts
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [path]
  });

  if (existingContexts.length > 0) {
    return;
  }

  // creation lock
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Streaming TTS',
    });

    try {
      await creating;
    } catch (e) {
      console.error("Offscreen creation failed:", e);
      // We must clear creating, otherwise we are stuck forever
      // We also might want to retry? For now, just ensure we don't lock.
    } finally {
      creating = null;
    }
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle_reader") {
    let stopped = false;
    try {
      stopped = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "TOGGLE_PLAYBACK" }, (response) => {
          if (chrome.runtime.lastError) resolve(false);
          else resolve(response && response.wasPlaying);
        });
      });
    } catch (e) {}

    if (stopped) return; // We stopped playback, so we don't start it again

    // Wasn't playing, start reading
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_FULL_PAGE_TEXT" });
      if (response && response.chunks && response.chunks.length > 0) {
        processAndPlay(response.chunks);
      } else if (response && response.text) {
        processAndPlay(response.text);
      }
    } catch (e) {
      console.error("Could not read page", e);
    }
  }
});