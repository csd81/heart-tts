let playbackQueue = [];
let currentIndex = 0;
let isPlaying = false;
let currentSource = null;
let audioContext = null;
let currentVoice = "af_bella";
let currentSpeed = 1.0;
let currentStreamId = 0;
let currentModel = "supertonic";
let currentAbortController = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_STREAM") {
    currentStreamId++;
    const thisStreamId = currentStreamId;
    stopPlayback();

    // NEW: Capture the model from the background script
    currentModel = message.model || "supertonic";
    currentVoice = message.voice || "Sarah";
    currentSpeed = message.speed || 1.0;
    playbackQueue = message.chunks;
    currentIndex = 0;

    if (!isPlaying) {
      playNextChunk(thisStreamId);
    }
  } else if (message.type === "TOGGLE_PLAYBACK") {
    if (isPlaying) {
      stopPlayback();
      sendResponse({ wasPlaying: true });
    } else {
      sendResponse({ wasPlaying: false });
    }
  } else if (message.type === "NEXT_CHUNK") {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    if (currentSource) {
      currentSource.onended = null;
      try { currentSource.stop(); } catch(e) {}
      currentSource = null;
    }
    currentIndex++;
    playNextChunk(currentStreamId);
  } else if (message.type === "PREV_CHUNK") {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    if (currentSource) {
      currentSource.onended = null;
      try { currentSource.stop(); } catch(e) {}
      currentSource = null;
    }
    currentIndex = Math.max(0, currentIndex - 1);
    playNextChunk(currentStreamId);
  }
  return true;
});

function stopPlayback() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  if (currentSource) {
    currentSource.onended = null;
    try {
      currentSource.stop();
    } catch (e) {
      // Ignore if already stopped
    }
    currentSource = null;
  }
  playbackQueue = [];
  currentIndex = 0;
  isPlaying = false;
  
  // Clear highlights when playback stops entirely
  chrome.runtime.sendMessage({
    type: "FORWARD_TO_ACTIVE_TAB",
    action: "CLEAR_HIGHLIGHT"
  }).catch(() => {});
}

async function playNextChunk(streamId) {
  if (streamId !== currentStreamId) {
    console.log("Stream changed, ignoring playNextChunk for old stream.");
    return;
  }

  if (currentIndex >= playbackQueue.length) {
    console.log("Queue finished.");
    isPlaying = false;
    
    // Clear highlights when queue is done
    chrome.runtime.sendMessage({
      type: "FORWARD_TO_ACTIVE_TAB",
      action: "CLEAR_HIGHLIGHT"
    }).catch(() => {});
    return;
  }

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  isPlaying = true;
  
  // Save the original text to send to the content script for accurate highlighting
  let originalText = playbackQueue[currentIndex];
  if (!originalText) return;
  let text = originalText
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  // Tell the active tab to highlight this specific sentence
  chrome.runtime.sendMessage({
    type: "FORWARD_TO_ACTIVE_TAB",
    action: "HIGHLIGHT_TEXT",
    text: originalText
  }).catch(() => {});

  console.log("Playing chunk:", text.substring(0, 30) + "...");

  try {
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    let endpoint = "http://127.0.0.1:8000/audio/speech";
    let payload = {
      input: text,
      model: currentModel,
      voice: currentVoice,
      speed: currentSpeed
    };

    // Kokoro server has a slightly different format (doesn't expect model param, expects speed float etc)
    // but its endpoint is also /audio/speech. If the user selects kokoro, we just send it there.
    // The kokoro server ignores the 'model' field since it evaluates locally. 
    
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: signal
    });

    if (!response.ok) throw new Error("Server Status: " + response.status);

    const arrayBuffer = await response.arrayBuffer();
    if (streamId !== currentStreamId) return;

    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    if (streamId !== currentStreamId) return;

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    source.onended = () => {
      currentSource = null;
      currentIndex++;
      playNextChunk(streamId);
    };

    currentSource = source;
    source.start();

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Fetch aborted for chunk:', text.substring(0, 30) + "...");
      return;
    }
    console.error("Playback failed for chunk:", text, err);
    if (streamId === currentStreamId) {
      playNextChunk(streamId);
    }

    chrome.runtime.sendMessage({
      type: "PLAYBACK_ERROR",
      error: err.toString()
    }).catch(() => { });
  }
}