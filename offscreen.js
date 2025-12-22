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
}

async function playNextChunk(streamId) {
  // Check if this execution belongs to the current active stream
  if (streamId !== currentStreamId) {
    console.log("Stream changed, ignoring playNextChunk for old stream.");
    return;
  }

  if (playbackQueue.length === 0) {
    console.log("Queue finished.");
    isPlaying = false;
    return;
  }

  // Initialize AudioContext if needed
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  isPlaying = true;
  // Clean text: remove special quotes that might break the server
  let text = playbackQueue.shift()
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

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

    // Double check stream ID after async fetch
    if (streamId !== currentStreamId) return;

    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Triple check after decode
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
    // If error occurs, we still try next chunk in SAME stream?
    // Or we stop? Usually better to try next.
    if (streamId === currentStreamId) {
      // Maybe wait a bit?
      playNextChunk(streamId);
    }

    chrome.runtime.sendMessage({
      type: "PLAYBACK_ERROR",
      error: err.toString()
    }).catch(() => { });
  }
}