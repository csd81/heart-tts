#!/bin/bash

# --- CONFIGURATION ---
VENV_PATH="$HOME/heart-tts/venv"
CHECKPOINT_DIR="$HOME/heart-tts/venv//fish-speech/checkpoints/openaudio-s1-mini"
PORT=8000

echo "🚀 Starting Fish Audio S1-mini Server..."

# 1. Enter the project directory (Change this if your path is different)
cd "$(dirname "$0")"

# 2. Activate Virtual Environment
if [ -d "$VENV_PATH" ]; then
    source "$VENV_PATH/bin/activate"
    echo "✅ Virtual environment activated."
else
    echo "❌ Error: Virtual environment not found at $VENV_PATH"
    exit 1
fi

# 3. Check if GPU is available (Quick check)
if ! command -v nvidia-smi &> /dev/null; then
    echo "⚠️  Warning: nvidia-smi not found. Ensure NVIDIA drivers are installed."
fi

# 4. Run the API Server
# Using --device cuda for your NVIDIA GPU
# Using --compile for Triton-optimized kernels
python3 -m tools.api_server \
    --listen 127.0.0.1 \
    --port $PORT \
    --device cuda \
    --llama-checkpoint "$CHECKPOINT_DIR/text2semantic" \
    --decoder-checkpoint "$CHECKPOINT_DIR/codec" \
    --compile