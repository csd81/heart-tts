let playbackQueue = [];
let isPlaying = false;
let currentSource = null;
let audioContext = null;
let currentVoice = "af_bella";
let currentSpeed = 1.0;
let currentStreamId = 0;

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === "START_STREAM") {
    console.log("Stream received. Chunks:", message.chunks.length);

    // Increment stream ID to invalidate any pending old callbacks
    currentStreamId++;
    const thisStreamId = currentStreamId;

    stopPlayback();

    currentVoice = message.voice || "af_bella";
    currentSpeed = message.speed || 1.0;
    playbackQueue = message.chunks;

    if (!isPlaying) {
      playNextChunk(thisStreamId);
    }
  }
});

function stopPlayback() {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch (e) {
      // Ignore if already stopped
    }
    currentSource = null;
  }
  playbackQueue = [];
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

  if (playbackQueue.length === 0) {
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
  let originalText = playbackQueue.shift();
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
    const response = await fetch("http://127.0.0.1:8000/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text,
        voice: currentVoice,
        speed: currentSpeed
      })
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
      playNextChunk(streamId);
    };

    currentSource = source;
    source.start();

  } catch (err) {
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