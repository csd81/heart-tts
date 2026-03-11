import io
import soundfile as sf
from fastapi import FastAPI, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from kokoro_onnx import Kokoro

app = FastAPI()

# 1. FIX CORS: Required so the Chrome Extension can talk to localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the ONNX model
# Ensure these files are in the same directory as this script
kokoro = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")

# 2. VOICE LIST ENDPOINT: Matches extension's "/audio/voices" call
@app.get("/audio/voices")
async def get_voices():
    # Return exactly the format the extension expects
    return {
        "voices": [
            "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", 
            "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", 
            "af_sky"
        ]
    }

# 3. SPEECH ENDPOINT: Matches extension's POST to "/audio/speech"
@app.post("/audio/speech")
async def speech(request: Request):
    try:
        data = await request.json()
        text = data.get("input", "")
        voice = data.get("voice", "af_bella")
        speed = data.get("speed", 1.0)

        # Generate audio samples using Kokoro-ONNX
        samples, sample_rate = kokoro.create(
            text, 
            voice=voice, 
            speed=float(speed), 
            lang="en-us"
        )
        
        # Save to buffer as WAV
        out = io.BytesIO()
        sf.write(out, samples, sample_rate, format='WAV')
        
        return Response(content=out.getvalue(), media_type="audio/wav")
    except Exception as e:
        print(f"Error: {e}")
        return Response(content=str(e), status_code=500)

if __name__ == "__main__":
    import uvicorn
    # Run on port 8000
    uvicorn.run(app, host="127.0.0.1", port=8000)