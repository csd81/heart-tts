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
  // 1. Check if we should stop
  if (streamId !== currentStreamId || currentIndex >= playbackQueue.length) {
    isPlaying = false;
    chrome.runtime.sendMessage({ type: "FORWARD_TO_ACTIVE_TAB", action: "CLEAR_HIGHLIGHT" });
    return;
  }

  // 2. Initialize or resume AudioContext
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();

  isPlaying = true;
  let textChunk = playbackQueue[currentIndex];
  
  // Highlight the current text chunk in the browser
  chrome.runtime.sendMessage({ type: "FORWARD_TO_ACTIVE_TAB", action: "HIGHLIGHT_TEXT", text: textChunk });

  try {
    currentAbortController = new AbortController();
    
    // 3. Build payload
    const endpoint = "http://127.0.0.1:8000/audio/speech";
    const payload = {
      input: textChunk,
      model: model,
      voice: voice,
      speed: parseFloat(speed)
    };

    // 4. Fetch the audio from the local server
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: currentAbortController.signal
    });

    if (!response.ok) {
      throw new Error(`Server Error: ${response.status} - ${response.statusText}`);
    }

    // 6. Decode and Prepare Audio
    const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
    
    // Double check we haven't skipped to a new stream while decoding
    if (streamId !== currentStreamId) return;

    const source = audioContext.createBufferSource();
    source.buffer = buffer;

    // 7. Play the chunk
    source.connect(audioContext.destination);
    source.onended = () => {
      currentIndex++;
      playNextChunk(streamId, model, voice, speed); // Recursively play the next chunk
    };
    
    currentSource = source;
    source.start();

  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(`Playback error on chunk ${currentIndex}:`, err);
      // Skip the broken chunk and try the next one
      currentIndex++;
      playNextChunk(streamId, model, voice, speed);
    }
  }
}