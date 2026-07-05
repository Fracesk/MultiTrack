"""
Audio Processing Pipeline - orchestrates full processing workflow
"""
from typing import Optional, Callable
from pathlib import Path

from engine.separator import separation_engine
from engine.vc import vc_engine
from engine.mixer import mixer_engine, TrackConfig
from utils.audio_utils import convert_to_wav, encode_audio
from utils.file_manager import file_manager
from config import SAMPLE_RATE


class ProcessingPipeline:
    """
    Full audio processing pipeline:
    Import -> Preprocess -> Separate -> Optional VC -> Mix -> Export
    """

    def process(
        self,
        input_path: str,
        separation_mode: str = "2stems",
        voice_id: Optional[str] = None,
        voice_params: Optional[dict] = None,
        export_format: str = "mp3",
        export_bitrate: int = 320,
        include_stems: bool = False,
        stem_config: Optional[dict] = None,
        progress_callback: Optional[Callable[[int, str], None]] = None
    ) -> dict:
        def progress(pct, msg):
            if progress_callback:
                progress_callback(pct, msg)

        try:
            # Stage 1: Convert to WAV
            progress(5, "Preprocessing audio...")
            wav_path = convert_to_wav(input_path, SAMPLE_RATE)
            if not wav_path:
                return {"status": "error", "message": "Audio conversion failed"}

            # Stage 2: Separate stems
            progress(10, "Loading separation model...")
            separation_engine.load_model()

            stems = separation_engine.separate(
                wav_path,
                mode=separation_mode,
                progress_callback=lambda p, s: progress(10 + int(p * 0.4), s)
            )

            # Stage 3: Voice conversion
            converted_vocals = None
            if voice_id and "vocals" in stems:
                progress(55, "Loading voice model...")
                converted_vocals = vc_engine.convert(
                    stems["vocals"],
                    voice_id=voice_id,
                    params=voice_params,
                    progress_callback=lambda p, s: progress(55 + int(p * 0.25), s)
                )

            # Stage 4: Mix
            progress(80, "Mixing tracks...")
            tracks = []

            for stem_type, file_path in stems.items():
                track_cfg = {"volume": 1.0, "pan": 0.0, "muted": False}
                if stem_config and stem_type in stem_config:
                    track_cfg.update(stem_config[stem_type])

                actual_path = file_path
                if stem_type == "vocals" and converted_vocals:
                    actual_path = converted_vocals

                tracks.append(TrackConfig(
                    file_path=actual_path,
                    volume=track_cfg["volume"],
                    pan=track_cfg["pan"],
                    muted=track_cfg["muted"],
                ))

            stem_name = Path(input_path).stem
            export_filename = f"{stem_name}_voicecraft"
            export_path = str(file_manager.create_export_path(export_filename))

            temp_mixed = file_manager.create_temp_file("_mixed.wav")
            mixer_engine.mix(tracks, str(temp_mixed), SAMPLE_RATE)

            final_path = str(export_path) + f".{export_format}"
            encode_audio(str(temp_mixed), final_path, export_format, export_bitrate)

            result = {
                "status": "success",
                "export_path": final_path,
                "message": f"Export successful: {final_path}"
            }

            if include_stems:
                stem_paths = {}
                for stem_type, file_path in stems.items():
                    stem_out = str(export_path) + f"_{stem_type}.{export_format}"
                    actual = converted_vocals if stem_type == "vocals" and converted_vocals else file_path
                    encode_audio(actual, stem_out, export_format, export_bitrate)
                    stem_paths[stem_type] = stem_out
                result["stem_paths"] = stem_paths

            progress(100, "Done")
            return result

        except Exception as e:
            return {"status": "error", "message": f"Processing failed: {str(e)}"}


pipeline = ProcessingPipeline()
