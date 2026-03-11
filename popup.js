const modelSelect = document.getElementById('modelSelect');
const voiceSelect = document.getElementById('voiceSelect');
const speedRange = document.getElementById('speedRange');
const speedValue = document.getElementById('speedValue');
const playButton = document.getElementById('playSample');
const readPageButton = document.getElementById('readPage');
const stopBtn = document.getElementById('stopBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

// 1. Fetch config from server on load
async function fetchConfig() {
  let allModels = [];
  let allVoices = [];
  
  // Try fetching Supertonic config
  try {
    const resSuper = await fetch("http://127.0.0.1:8000/api/config", { signal: AbortSignal.timeout(1000) });
    if (resSuper.ok) {
      const data = await resSuper.json();
      allModels.push(...data.models);
      // We'll only load voices for the currently selected model later,
      // but for now, we just store the supertonic voices as default if supertonic is available.
      if (allVoices.length === 0) allVoices.push(...data.voices);
    }
  } catch (err) { console.warn("Supertonic not found"); }

  // Try fetching Kokoro config
  try {
    const resKokoro = await fetch("http://127.0.0.1:8000/audio/voices", { signal: AbortSignal.timeout(1000) });
    if (resKokoro.ok) {
      // Kokoro is running
      allModels.push("kokoro");
      const data = await resKokoro.json();
      // If no supertonic voices were loaded, or if kokoro is the only one, save these
      if (allVoices.length === 0) allVoices.push(...data.voices);
      
      // Store kokoro voices globally so we can swap them when model changes
      window.kokoroVoices = data.voices; 
    }
  } catch (err) { console.warn("Kokoro not found"); }

  if (allModels.length === 0) {
    modelSelect.innerHTML = '<option>Server Offline</option>';
    voiceSelect.innerHTML = '<option>Server Offline</option>';
    return;
  }

  // Build Model Dropdown
  modelSelect.innerHTML = '';
  allModels.forEach(model => {
    const opt = document.createElement('option');
    opt.value = model; opt.textContent = model;
    modelSelect.appendChild(opt);
  });

  // Build Voice Dropdown (Initial)
  voiceSelect.innerHTML = '';
  allVoices.forEach(voice => {
    const opt = document.createElement('option');
    opt.value = voice; opt.textContent = voice;
    voiceSelect.appendChild(opt);
  });

  // Load saved choices after populating
  loadSavedSettings();
}

async function updateVoicesForModel(modelName) {
  voiceSelect.innerHTML = '';
  
  if (modelName === "kokoro") {
    const voices = window.kokoroVoices || [
      "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", 
      "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", 
      "af_sky"
    ];
    voices.forEach(voice => {
      const opt = document.createElement('option');
      opt.value = voice; opt.textContent = voice;
      voiceSelect.appendChild(opt);
    });
  } else {
    // Re-fetch supertonic voices
    try {
      const res = await fetch("http://127.0.0.1:8000/api/config");
      const data = await res.json();
      data.voices.forEach(voice => {
        const opt = document.createElement('option');
        opt.value = voice; opt.textContent = voice;
        voiceSelect.appendChild(opt);
      });
    } catch(e) {}
  }
}

function loadSavedSettings() {
  chrome.storage.local.get(['selectedModel', 'selectedVoice', 'playbackSpeed'], (result) => {
    if (result.selectedModel && Array.from(modelSelect.options).some(o => o.value === result.selectedModel)) {
      modelSelect.value = result.selectedModel;
    }
    if (result.selectedVoice && Array.from(voiceSelect.options).some(o => o.value === result.selectedVoice)) {
      voiceSelect.value = result.selectedVoice;
    }
    if (result.playbackSpeed) {
      speedRange.value = result.playbackSpeed;
      speedValue.textContent = result.playbackSpeed;
    }
  });
}

// 2. Save settings when changed
modelSelect.addEventListener('change', () => {
  chrome.storage.local.set({ selectedModel: modelSelect.value });
  updateVoicesForModel(modelSelect.value);
});
voiceSelect.addEventListener('change', () => chrome.storage.local.set({ selectedVoice: voiceSelect.value }));
speedRange.addEventListener('input', () => speedValue.textContent = speedRange.value);
speedRange.addEventListener('change', () => chrome.storage.local.set({ playbackSpeed: speedRange.value }));

// Initialize
fetchConfig();

// 3. Handle PLAY button
playButton.addEventListener('click', async () => {
  if (modelSelect.value === 'Server Offline') {
    alert("❌ Server Offline. Please start your Python server.");
    return;
  }

  const selectedModel = modelSelect.value;
  const selectedVoice = voiceSelect.value;
  const selectedSpeed = parseFloat(speedRange.value);
  const testText = [`Testing the ${selectedVoice} voice on ${selectedModel} at speed ${selectedSpeed}`];

  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length === 0) {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Testing voice'
      });
    } catch (e) { }
  }

  chrome.runtime.sendMessage({
    type: "START_STREAM",
    chunks: testText,
    model: selectedModel,
    voice: selectedVoice,
    speed: selectedSpeed
  });
});

// 5. Handle BACK/FORWARD/STOP buttons
if (prevBtn) prevBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: "PREV_CHUNK" }));
if (nextBtn) nextBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: "NEXT_CHUNK" }));
if (stopBtn) stopBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: "TOGGLE_PLAYBACK" }));

// 6. Handle READ PAGE button
readPageButton.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_FULL_PAGE_TEXT" });
    if (response && response.chunks && response.chunks.length > 0) {
      chrome.runtime.sendMessage({
        action: "PLAY_TEXT",
        chunks: response.chunks
      });
    } else if (response && response.text) {
      chrome.runtime.sendMessage({
        action: "PLAY_TEXT",
        text: response.text
      });
    }
  } catch (e) {
    alert("Could not read page. try refreshing.");
  }
});