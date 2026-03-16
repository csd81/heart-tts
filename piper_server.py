from fastapi import FastAPI, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from piper.voice import PiperVoice
import wave
import io
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VOICES_DIR = os.path.expanduser("~/heart-tts/piper-voices")

VOICE_FILES = {
    "anna":  "hu_HU-anna-medium.onnx",
    "berta": "hu_HU-berta-medium.onnx",
    "imre":  "hu_HU-imre-medium.onnx",
}

print("Loading Piper voices...")
voices = {}
for name, filename in VOICE_FILES.items():
    path = os.path.join(VOICES_DIR, filename)
    voices[name] = PiperVoice.load(path)
    print(f"  ✅ {name} loaded")
print("All voices ready.")


@app.get("/api/config")
def get_config():
    return {
        "models": ["piper"],
        "voices": list(VOICE_FILES.keys()),
    }


class TTSRequest(BaseModel):
    input: str
    model: str = "piper"
    voice: str = "anna"
    speed: float = 1.0


@app.post("/audio/speech")
async def synthesize(request: TTSRequest):
    voice = voices.get(request.voice)
    if voice is None:
        raise HTTPException(status_code=400, detail=f"Unknown voice: {request.voice}")

    print(f"[{request.voice}] {request.input[:60]}")

    wav_io = io.BytesIO()
    with wave.open(wav_io, "wb") as wav_file:
        voice.synthesize(request.input, wav_file)

    return Response(content=wav_io.getvalue(), media_type="audio/wav")
