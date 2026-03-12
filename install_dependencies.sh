 
#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting Supertonic TTS Backend Setup..."

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
pip install kokoro-onnx
pip install fastapi uvicorn pydantic soundfile numpy onnxruntime

# 4. Download Model Files & Scripts
echo "⚙️ Setting up Git LFS (required for large ONNX models)..."
sudo apt-get update
sudo apt-get install git-lfs
git lfs install

# Download the actual ONNX model weights into an 'assets' folder
if [ ! -d "assets" ]; then
    echo "📥 Downloading Supertonic ONNX models from Hugging Face..."
    git clone https://huggingface.co/Supertone/supertonic assets
else
    echo "✅ Model assets already present in 'assets/' directory."
fi

# Download Supertonic 2
if [ ! -d "assets_v2" ]; then
    echo "📥 Downloading Supertonic 2 ONNX models from Hugging Face..."
    git clone https://huggingface.co/Supertone/supertonic-2 assets_v2
else
    echo "✅ Model assets already present in 'assets_v2/' directory."
fi

# Download the official Python inference scripts from Supertone
if [ ! -d "py" ]; then
    echo "📥 Downloading Supertonic inference scripts..."
    git clone https://github.com/supertone-inc/supertonic.git supertonic_scripts
    mv supertonic_scripts/py ./py
    rm -rf supertonic_scripts
else
    echo "✅ Supertonic python scripts already present."
fi

echo "---"
echo "🎉 Setup complete!"
echo "To start the server, run:"
echo "source venv/bin/activate && python server.py"