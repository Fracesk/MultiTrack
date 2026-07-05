# -*- coding: utf-8 -*-
"""
VoiceCraft - 全局配置
"""
import os
from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).parent
MODELS_DIR = BASE_DIR / "models"
CHECKPOINTS_DIR = MODELS_DIR / "checkpoints"
CUSTOM_MODELS_DIR = MODELS_DIR / "custom"
DATA_DIR = BASE_DIR / "data"
TEMP_DIR = DATA_DIR / "temp"
EXPORTS_DIR = DATA_DIR / "exports"

# Ensure directories exist
for d in [MODELS_DIR, CHECKPOINTS_DIR, CUSTOM_MODELS_DIR, TEMP_DIR, EXPORTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# Audio settings
SAMPLE_RATE = 44100
SUPPORTED_FORMATS = {".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a"}
MAX_FILE_SIZE_MB = 200

# Separation
SEPARATION_MODES = {
    "2stems": ["vocals", "accompaniment"],
    "4stems": ["vocals", "bass", "drums", "other"],
    "6stems": ["vocals", "bass", "drums", "piano", "guitar", "other"],
}

# Voice conversion
BUILTIN_VOICES_DIR = CHECKPOINTS_DIR / "builtin_voices"
PITCH_SHIFT_RANGE = (-12, 12)
FORMANT_SHIFT_RANGE = (-5.0, 5.0)
INTENSITY_RANGE = (0, 100)

# Server
API_HOST = "127.0.0.1"
API_PORT = 8756

# Logging
LOG_LEVEL = "INFO"
