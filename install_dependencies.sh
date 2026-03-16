 
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

# 5. Install Piper TTS
echo "📦 Installing piper-tts..."
pip install piper-tts

# Download Hungarian Piper voices
VOICES_DIR="piper-voices"
mkdir -p "$VOICES_DIR"

BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/hu/hu_HU"

declare -A PIPER_VOICES=(
    ["anna"]="anna/medium"
    ["berta"]="berta/medium"
    ["imre"]="imre/medium"
)

for name in "${!PIPER_VOICES[@]}"; do
    path="${PIPER_VOICES[$name]}"
    onnx_file="hu_HU-${name}-medium.onnx"
    json_file="${onnx_file}.json"

    if [ ! -f "$VOICES_DIR/$onnx_file" ]; then
        echo "📥 Downloading Piper voice: $name..."
        wget -q --show-progress -O "$VOICES_DIR/$onnx_file" "${BASE_URL}/${path}/${onnx_file}"
        wget -q -O "$VOICES_DIR/$json_file" "${BASE_URL}/${path}/${json_file}"
    else
        echo "✅ Piper voice '$name' already present."
    fi
done

echo "---"
echo "🎉 Setup complete!"
echo "To start the Piper TTS server, run:"
echo "  ./run_piper.sh"