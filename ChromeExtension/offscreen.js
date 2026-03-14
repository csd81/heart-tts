let playbackQueue = [];
let currentIndex = 0;
let isPlaying = false;
let currentSource = null;
let audioContext = null;
let currentStreamId = 0;
let currentAbortController = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_STREAM") {
    currentStreamId++;
    const thisStreamId = currentStreamId;
    stopPlayback();
    playbackQueue = message.chunks;
    currentIndex = 0;
    playNextChunk(thisStreamId, message.model, message.voice, message.speed);
  } else if (message.type === "TOGGLE_PLAYBACK") {
    const wasPlaying = isPlaying;
    stopPlayback();
    sendResponse({ wasPlaying });
  }
  return true;
});

function stopPlayback() {
  if (currentAbortController) currentAbortController.abort();
  if (currentSource) {
    currentSource.onended = null;
    try { currentSource.stop(); } catch (e) {}
    currentSource = null;
  }
  isPlaying = false;
  chrome.runtime.sendMessage({ type: "FORWARD_TO_ACTIVE_TAB", action: "CLEAR_HIGHLIGHT" });
}

async function playNextChunk(streamId, model, voice, speed) {
  if (streamId !== currentStreamId || currentIndex >= playbackQueue.length) {
    isPlaying = false;
    chrome.runtime.sendMessage({ type: "FORWARD_TO_ACTIVE_TAB", action: "CLEAR_HIGHLIGHT" });
    return;
  }

  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();

  isPlaying = true;
  let text = playbackQueue[currentIndex];
  chrome.runtime.sendMessage({ type: "FORWARD_TO_ACTIVE_TAB", action: "HIGHLIGHT_TEXT", text });

  try {
    currentAbortController = new AbortController();
    const response = await fetch("http://127.0.0.1:8000/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, model, voice, speed }),
      signal: currentAbortController.signal
    });

    const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
    if (streamId !== currentStreamId) return;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      currentIndex++;
      playNextChunk(streamId, model, voice, speed);
    };
    currentSource = source;
    source.start();
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error("Playback error", err);
      currentIndex++;
      playNextChunk(streamId, model, voice, speed);
    }
  }
}