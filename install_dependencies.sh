#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting Heart-TTS Backend Setup..."

# 1. Create Virtual Environment
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
else
    echo "✅ Virtual environment already exists."
fi

# 2. Activate Environment
source venv/bin/activate

# 3. Install/Upgrade Dependencies
echo "pip 🆙 Upgrading pip and installing dependencies..."
pip install --upgrade pip
pip install fastapi uvicorn kokoro-onnx soundfile

# 4. Download Model Files (if they don't exist)
# kokoro-v1.0.onnx
if [ ! -f "kokoro-v1.0.onnx" ]; then
    echo "📥 Downloading Kokoro ONNX model..."
    curl -L https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx -o kokoro-v1.0.onnx
else
    echo "✅ Model file already present."
fi

# voices-v1.0.bin
if [ ! -f "voices-v1.0.bin" ]; then
    echo "📥 Downloading voice data..."
    curl -L https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin -o voices-v1.0.bin
else
    echo "✅ Voice data already present."
fi

echo "---"
echo "🎉 Setup complete!"
echo "To start the server, run:"
echo "source venv/bin/activate && python server.py"