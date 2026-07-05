import sys
# if r'C:\Users\lenovo\AppData\Local\Temp\pylibs' not in sys.path:
#     sys.path.insert(0, r'C:\Users\lenovo\AppData\Local\Temp\pylibs')
# -*- coding: utf-8 -*-
"""VoiceCraft API Server"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn, json, shutil, tempfile

from engine.pipeline import pipeline
from engine.vc import vc_engine, BUILTIN_VOICES, INSTRUMENT_VOICES
from utils.audio_utils import validate_audio_file, get_audio_info, convert_to_wav, encode_audio
from utils.file_manager import file_manager
from config import API_HOST, API_PORT, TEMP_DIR, SAMPLE_RATE

app = FastAPI(title="VoiceCraft API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.post("/api/spectrogram")
async def get_spectrogram(file: UploadFile = File(...), max_freq: int = Form(8000)):
    """Return spectrogram data for visualization."""
    suffix = os.path.splitext(file.filename)[1] or ".wav"
    temp_path = TEMP_DIR / f"spec_{int(__import__('time').time())}{suffix}"
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    valid, msg = validate_audio_file(str(temp_path))
    if not valid:
        os.unlink(temp_path)
        raise HTTPException(status_code=400, detail=msg)
    spec = separation_engine.get_spectrogram(str(temp_path), max_freq=max_freq)
    os.unlink(temp_path)
    if "error" in spec:
        raise HTTPException(status_code=500, detail=spec["error"])
    return spec


@app.get("/api/spectrogram")
async def get_spectrogram_by_path(audio_path: str = "", max_freq: int = 8000):
    """Return spectrogram of a processed audio file by path."""
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio not found")
    spec = separation_engine.get_spectrogram(audio_path, max_freq=max_freq)
    if "error" in spec:
        raise HTTPException(status_code=500, detail=spec["error"])
    return spec

@app.get("/api/voices")
async def list_voices():
    return {"builtin": BUILTIN_VOICES, "instrument": INSTRUMENT_VOICES, "custom": []}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload audio file and return server path."""
    suffix = os.path.splitext(file.filename)[1] or ".wav"
    temp_path = TEMP_DIR / f"upload_{int(__import__('time').time())}{suffix}"
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    valid, msg = validate_audio_file(str(temp_path))
    if not valid:
        os.unlink(temp_path)
        raise HTTPException(status_code=400, detail=msg)

    return {
        "status": "success",
        "path": str(temp_path),
        "filename": file.filename,
    }


@app.post("/api/separate")
async def separate(file: UploadFile = File(...), mode: str = Form("2stems")):
    """Upload audio and separate stems, return download URLs."""
    suffix = os.path.splitext(file.filename)[1] or ".wav"
    temp_path = TEMP_DIR / f"upload_{int(__import__('time').time())}{suffix}"
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    valid, msg = validate_audio_file(str(temp_path))
    if not valid:
        os.unlink(temp_path)
        raise HTTPException(status_code=400, detail=msg)

    # Convert to WAV first (supports MP3/FLAC)
    wav_path = convert_to_wav(str(temp_path), SAMPLE_RATE)
    if wav_path:
        try:
            if str(temp_path) != wav_path:
                os.unlink(temp_path)
        except:
            pass
        temp_path = wav_path

    sep_results = separation_engine.separate(
        str(temp_path), mode=mode,
        progress_callback=lambda p, s: None
    )

    # Build return
    stems_info = {}
    for stem_type, file_path in sep_results.items():
        stem_id = f"{stem_type}_{int(__import__('time').time())}"
        stems_info[stem_type] = {
            "path": file_path,
            "url": f"/api/audio/{os.path.basename(file_path)}",
            "stem_id": stem_id,
        }

    info = get_audio_info(str(temp_path))
    try:
        os.unlink(temp_path)
    except:
        pass

    return {"status": "success", "audio_info": info, "stems": stems_info}


@app.get("/api/audio/{filename}")
async def get_audio(filename: str):
    """Return audio file for frontend playback."""
    search_dirs = [TEMP_DIR]
    if hasattr(file_manager, "create_export_path"):
        search_dirs.append(file_manager.create_export_path("").parent)

    for base_dir in search_dirs:
        file_path = base_dir / filename
        if file_path.exists():
            return FileResponse(str(file_path), media_type="audio/wav", filename=filename)

    # Search system temp directory
    sys_temp = os.path.join(tempfile.gettempdir(), filename)
    if os.path.exists(sys_temp):
        return FileResponse(sys_temp, media_type="audio/wav", filename=filename)

    raise HTTPException(status_code=404, detail=f"Audio file not found: {filename}")


@app.get("/api/melody")
async def get_melody(audio_path: str = ""):
    """提取音频的旋律音高序列，用于前端可视化展示音高轮廓"""
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="音频文件未找到")
    try:
        pitch_data = vc_engine.extract_melody(audio_path)
        return {
            "status": "success",
            "pitch": pitch_data["pitch"].tolist(),
            "confidence": pitch_data["confidence"].tolist(),
            "midi_notes": pitch_data["midi_notes"].tolist(),
            "note_names": pitch_data["note_names"],
            "timestamps": pitch_data["timestamps"].tolist(),
            "hop_time": pitch_data["hop_time"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"旋律提取失败: {str(e)}")

@app.post("/api/convert")
async def convert(audio_path: str = Form(...), voice_id: str = Form(...),
                  pitch_shift: float = Form(0), intensity: int = Form(80)):
    """Apply voice conversion on vocal stem."""
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Source audio not found")

    result_path = vc_engine.convert(audio_path, voice_id,
                                     params={"pitch_shift": pitch_shift, "intensity": intensity})
    if not result_path or not os.path.exists(result_path):
        raise HTTPException(status_code=500, detail="Voice conversion failed")

    return {
        "status": "success",
        "path": result_path,
        "url": f"/api/audio/{os.path.basename(result_path)}",
    }


@app.post("/api/process")
async def process_pipeline(
    file: UploadFile = File(...), mode: str = Form("2stems"),
    voice_id: str = Form(None), voice_params: str = Form("{}"),
    export_format: str = Form("mp3"), export_bitrate: int = Form(320),
    include_stems: bool = Form(False), stem_config: str = Form("{}"),
):
    """Complete processing pipeline."""
    temp_path = TEMP_DIR / f"upload_{file.filename}"
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    valid, msg = validate_audio_file(str(temp_path))
    if not valid:
        os.unlink(temp_path)
        raise HTTPException(status_code=400, detail=msg)

    params = json.loads(voice_params)
    stem_cfg = json.loads(stem_config)

    result = pipeline.process(
        input_path=str(temp_path), separation_mode=mode,
        voice_id=voice_id, voice_params=params,
        export_format=export_format, export_bitrate=export_bitrate,
        include_stems=include_stems, stem_config=stem_cfg,
    )

    os.unlink(temp_path)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result


@app.post("/api/export")
async def export_audio(audio_path: str = Form(...), format: str = Form("wav"), bitrate: int = Form(320)):
    """Export/convert audio file to specified format."""
    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio not found")
    stem_name = os.path.splitext(os.path.basename(audio_path))[0]
    out_path = TEMP_DIR / f"{stem_name}_export.{format}"
    try:
        encode_audio(audio_path, str(out_path), format, bitrate)
        return FileResponse(str(out_path), media_type=f"audio/{format}", filename=f"{stem_name}.{format}",
                           headers={"Content-Disposition": 'attachment; filename="' + stem_name + '.' + format + '"'})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


@app.get("/api/download/{filename}")
async def download_audio(filename: str):
    """Download audio file directly."""
    from pathlib import Path as PPath
    possible = [TEMP_DIR / filename, PPath(tempfile.gettempdir()) / filename]
    for p in possible:
        if p.exists():
            return FileResponse(str(p), media_type="audio/wav", filename=filename,
                               headers={"Content-Disposition": 'attachment; filename="' + filename + '"'})
    raise HTTPException(status_code=404, detail=f"File not found: {filename}")

from engine.separator import separation_engine

if __name__ == "__main__":
    print(f"VoiceCraft API on {API_HOST}:{API_PORT}")
    file_manager.start_cleanup_thread()
    uvicorn.run(app, host=API_HOST, port=API_PORT, log_level="info")


