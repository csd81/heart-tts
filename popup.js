const voiceSelect = document.getElementById('voiceSelect');
const speedRange = document.getElementById('speedRange');
const speedValue = document.getElementById('speedValue');
const playButton = document.getElementById('playSample');

// 1. Load saved settings
chrome.storage.local.get(['selectedVoice', 'playbackSpeed'], (result) => {
  if (result.selectedVoice) {
    voiceSelect.value = result.selectedVoice;
  }
  if (result.playbackSpeed) {
    speedRange.value = result.playbackSpeed;
    speedValue.textContent = result.playbackSpeed;
  }
});

// 2. Save settings on change
voiceSelect.addEventListener('change', () => {
  chrome.storage.local.set({ selectedVoice: voiceSelect.value });
});

speedRange.addEventListener('input', () => {
  speedValue.textContent = speedRange.value;
});

speedRange.addEventListener('change', () => {
  chrome.storage.local.set({ playbackSpeed: speedRange.value });
});

// 3. Handle PLAY button
playButton.addEventListener('click', async () => {
  const selectedVoice = voiceSelect.value;
  const selectedSpeed = parseFloat(speedRange.value);
  const testText = ["Testing the " + selectedVoice.replace('af_', '').replace('am_', '').replace('bf_', '').replace('bm_', '') + " voice at speed " + selectedSpeed];

  // --- STEP A: SERVER CHECK (GET) ---
  try {
    const check = await fetch("http://127.0.0.1:8000/audio/voices", {
      method: "GET",
      signal: AbortSignal.timeout(2000)
    });
    if (!check.ok) throw new Error();
    console.log("Server is online.");
  } catch (e) {
    alert("❌ Server Offline. Please start your Python server.");
    return;
  }

  // --- STEP B: ENSURE OFFSCREEN ---
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length === 0) {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Testing voice'
      });
    } catch (e) {
      // Ignore if it was created concurrently
      console.log("Offscreen doc creation handled:", e.message);
    }
  }

  // --- STEP C: SEND DATA (TRIGGER POST IN OFFSCREEN) ---
  chrome.runtime.sendMessage({
    type: "START_STREAM",
    chunks: testText,
    voice: selectedVoice,
    speed: selectedSpeed
  });
});

// 4. Handle READ PAGE button
document.getElementById('readPage').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_TEXT_FROM_HERE" });
    if (response && response.text) {
      // Trigger playback via background (or directly here if logic is duplicated)
      // Background has logic to split and play. Let's send a message to background to play it.
      // Actually background listens for "PLAY_TEXT" from content script. We can use that.

      chrome.runtime.sendMessage({
        action: "PLAY_TEXT",
        text: response.text
      });
    } else {
      console.log("No text found or empty response");
    }
  } catch (e) {
    console.warn("Could not read page:", e);
    alert("Could not read page. try refreshing.");
  }
});