chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "read-from-here",
    title: "Read from here",
    contexts: ["all"]
  });
});

async function processAndPlay(text) {
  if (!text) return;

  // Improved Splitting: Split by newlines OR sentences followed by a space
  const chunks = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter(chunk => chunk.trim().length > 2); // Ignore tiny fragments

  const settings = await chrome.storage.local.get(['selectedVoice', 'playbackSpeed']);
  const currentVoice = settings.selectedVoice || "af_bella";
  const currentSpeed = settings.playbackSpeed || 1.2;

  await setupOffscreenDocument('offscreen.html');

  // Send message immediately after awaiting creation
  chrome.runtime.sendMessage({
    type: "START_STREAM",
    chunks: chunks,
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

// Listen for direct requests from content script (Button click)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PLAY_TEXT" && request.text) {
    processAndPlay(request.text);
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