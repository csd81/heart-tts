# Kokoro TTS - Voice Selector Extension

This project is a Chrome extension that integrates with a local Kokoro TTS (Text-to-Speech) server to provide high-quality voice synthesis for web content.

## Features

- **High-Quality TTS**: Uses the [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx/) model for local, high-quality speech generation.
- **Voice Selection**: Choose from multiple voices (e.g., `af_bella`, `af_sarah`, `am_adam`, etc.).
- **Speed Control**: Adjust the playback speed of the speech.
- **Local Privacy**: Runs entirely locally on your machine using a Python backend.

## Prerequisites

Before running the extension, you need to set up the Python backend server.

### System Requirements
- Python 3.8+
- Chrome Browser

### Python Dependencies
Install the required Python libraries:

```bash
pip install fastapi uvicorn kokoro-onnx soundfile
```

### Download Model Files
You need to download the model (`kokoro-v1.0.onnx`) and voice data (`voices-v1.0.bin`) files to the root directory:

```bash
wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

## Setup & Installation

### 1. Start the Local Server
The extension relies on a local FastAPI server to perform the TTS inference.

Run the server:
```bash
python server.py
```
The server will start on `http://127.0.0.1:8000`.

### 2. Install the Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the directory containing this project (`read_aloud_extension-main`).
5. The extension should now appear in your browser toolbar.

## Usage

1. **Start the Server**: Ensure `python server.py` is running in a terminal.
2. **Open the Extension**: Click the extension icon in the Chrome toolbar.
3. **Select Voice & Speed**: Use the popup interface to configure your preferred voice and reading speed.
4. **Read Text**: (Depending on specific implementation details) Select text on a webpage or use the provided controls to read content aloud.

## Project Structure

- `manifest.json`: Chrome extension configuration.
- `server.py`: FastAPI backend that handles TTS requests using `kokoro-onnx`.
- `popup.html` / `popup.js`: The extension's user interface.
- `background.js`: Service worker for the extension.
- `content.js`: Script injected into webpages to interact with page content.
- `offscreen.html` / `offscreen.js`: Handles audio playback in the background.
- `kokoro-v1.0.onnx`: The ONNX model file for Kokoro TTS.
- `voices-v1.0.bin`: Binary file containing voice data.

## Troubleshooting

- **Server Connection Error**: Ensure the server is running on `localhost:8000`. Check the terminal for any error messages in `server.py`.
- **No Audio**: verify that your speakers are on and the volume is up. Check `offscreen.js` or the extension console for errors.
- **CORS Issues**: The `server.py` includes CORS middleware configuration to allow requests from the extension. Do not remove this configuration.
