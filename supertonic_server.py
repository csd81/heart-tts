import sys
import os
import io
import glob
import uvicorn
import soundfile as sf
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

# Add the cloned supertonic_scripts/py folder to Python's path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "supertonic_scripts", "py")))

try:
    from helper import load_voice_style
except ImportError as e:
    print(f"⚠️ Import Error for load_voice_style: {e}")
    load_voice_style = None

current_loaded_model_name = None
text_to_speech = None

def get_model_info(model_name: str):
    if model_name == "supertonic-2" and os.path.exists("assets_v2"):
        return {
            "onnx_dir": "assets_v2/onnx" if os.path.exists("assets_v2/onnx") else "assets_v2",
            "voice_dir": "assets_v2/voice_styles" if os.path.exists("assets_v2/voice_styles") else "assets_v2"
        }
    else:
        # Default to supertonic
        return {
            "onnx_dir": "assets/onnx" if os.path.exists("assets/onnx") else "assets",
            "voice_dir": "assets/voice_styles" if os.path.exists("assets/voice_styles") else "assets"
        }

def load_tts_model(model_name: str):
    global current_loaded_model_name, text_to_speech
    
    if current_loaded_model_name == model_name and text_to_speech is not None:
        return True # Already loaded
        
    info = get_model_info(model_name)
    try:
        print(f"Loading model '{model_name}' from {info['onnx_dir']}...")
        from helper import load_text_to_speech
        text_to_speech = load_text_to_speech(info['onnx_dir'], use_gpu=False)
        current_loaded_model_name = model_name
        print(f"Model '{model_name}' loaded successfully!")
        return True
    except Exception as e:
        print(f"⚠️ Error loading model '{model_name}': {e}")
        text_to_speech = None
        current_loaded_model_name = None
        return False

# Attempt to pre-load whatever is first available
AVAILABLE_MODELS = ["supertonic"]
if os.path.exists("assets_v2"):
    AVAILABLE_MODELS.append("supertonic-2")
    # Prefer supertonic-2 as default if it exists
    load_tts_model("supertonic-2") 
else:
    load_tts_model("supertonic")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TTSRequest(BaseModel):
    input: str
    voice: str = "M1"  # Supertonic voices are usually named like M1, F1, etc.
    model: str = "supertonic"
    speed: float = 1.05 # Supertonic's default speed in example_onnx.py is 1.05

@app.get("/api/config")
def get_config():
    # Dynamically find voices based on model
    info = get_model_info(current_loaded_model_name or "supertonic")
    voice_files = glob.glob(os.path.join(info['voice_dir'], "*.json"))
    voices = [os.path.splitext(os.path.basename(v))[0] for v in voice_files]
    if not voices:
        voices = ["M1", "F1"]
        
    # This automatically populates your Chrome Extension dropdowns!
    return {
        "models": AVAILABLE_MODELS,
        "voices": voices
    }

 

@app.post("/audio/speech")
def generate_speech(req: TTSRequest):
    print(f"Generating -> Model: {req.model} | Voice: {req.voice} | Speed: {req.speed}")
    print(f"Text: {req.input[:50]}...")
    
    import numpy as np
    
    # Load requested model if different (Warning: could take 1-3 seconds to load)
    if req.model in AVAILABLE_MODELS and req.model != current_loaded_model_name:
        load_tts_model(req.model)
        
    if text_to_speech is None:
        print("Model not loaded, returning silence.")
        audio_array = np.zeros(44100, dtype=np.float32)
        samplerate = 44100
    else:
        info = get_model_info(current_loaded_model_name)
        
        # 1. Load the specific voice style JSON
        voice_path = os.path.join(info['voice_dir'], f"{req.voice}.json")
        if not os.path.exists(voice_path):
            print(f"Warning: Voice file {voice_path} not found. Defaulting to M1.")
            voice_path = os.path.join(info['voice_dir'], "M1.json")
            
        style = load_voice_style([voice_path])
        
        # 2. Generate the audio
        try:
            raw_audio_array, duration = text_to_speech(
                req.input, 
                "en",       # language
                style, 
                5,          # total_step (default is 5)
                req.speed
            )
            
            samplerate = text_to_speech.sample_rate
            
            # The wav is already perfectly trimmed per chunk by our patched helper.py
            actual_audio = raw_audio_array[0]
            
            # Add 150ms of silence to start and end to prevent playback clipping (bluetooth/audio context issues)
            pad_len = int(samplerate * 0.15)
            padding = np.zeros(pad_len, dtype=np.float32)
            audio_array = np.concatenate([padding, actual_audio, padding])
        except Exception as e:
            print(f"⚠️ Generation Error: {e}")
            audio_array = np.zeros(44100, dtype=np.float32)
            samplerate = 44100

    # 3. CRITICAL FIX: Sanitize the audio array for soundfile
    # Flatten removes extra dimensions (e.g., [1, N] becomes [N])
    # float32 ensures the math works perfectly for PCM conversion
    audio_array = np.array(audio_array, dtype=np.float32).flatten()

    # 4. Save to buffer using strict WAV parameters
    buffer = io.BytesIO()
    sf.write(
        buffer, 
        audio_array, 
        samplerate=samplerate,
        format='WAV', 
        subtype='PCM_16'     # Force standard 16-bit audio
    )
    buffer.seek(0)

    return Response(content=buffer.read(), media_type="audio/wav")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)