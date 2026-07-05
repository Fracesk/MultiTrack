"""File management utilities."""
import os
import time
import threading
from pathlib import Path
from typing import Optional

from config import TEMP_DIR, EXPORTS_DIR, CUSTOM_MODELS_DIR


class FileManager:
    """Manages temp files, exports, and model files."""

    def __init__(self):
        self._interval = 3600
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start_cleanup_thread(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop_cleanup_thread(self):
        self._running = False

    def _loop(self):
        while self._running:
            self._cleanup(TEMP_DIR, 1)
            self._cleanup(EXPORTS_DIR, 24)
            time.sleep(self._interval)

    def _cleanup(self, directory: Path, max_hours: int):
        if not directory.exists():
            return
        now = time.time()
        for item in directory.iterdir():
            if item.is_file():
                age = (now - item.stat().st_mtime) / 3600
                if age > max_hours:
                    try:
                        item.unlink()
                    except OSError:
                        pass

    def create_temp_file(self, suffix: str = ".wav") -> Path:
        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        return TEMP_DIR / f"tmp_{int(time.time() * 1000000)}{suffix}"

    def create_export_path(self, filename: str) -> Path:
        EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
        return EXPORTS_DIR / filename

    def get_custom_model_path(self, voice_id: str) -> Path:
        return CUSTOM_MODELS_DIR / voice_id

    def clean_temp_files(self, project_id: str):
        for f in TEMP_DIR.glob(f"{project_id}_*"):
            try:
                f.unlink()
            except OSError:
                pass


file_manager = FileManager()
