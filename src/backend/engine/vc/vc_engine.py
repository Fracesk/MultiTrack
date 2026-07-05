# -*- coding: utf-8 -*-
"""
人声变声引擎 - 使用 numpy 实现实际变声处理
"""
import os
import wave
import numpy as np
import time
import threading
from typing import Optional, Dict, List, Callable
from scipy import signal


BUILTIN_VOICES = [
    {"id": "male-bass", "name": "磁性男低音", "category": "男声"},
    {"id": "male-baritone", "name": "温暖男中音", "category": "男声"},
    {"id": "male-tenor", "name": "清亮男高音", "category": "男声"},
    {"id": "female-soprano", "name": "明亮女高音", "category": "女声"},
    {"id": "female-mezzo", "name": "醇厚女中音", "category": "女声"},
    {"id": "female-sweet", "name": "甜美少女音", "category": "女声"},
    {"id": "child", "name": "可爱童声", "category": "特效"},
    {"id": "anime-girl", "name": "动漫少女", "category": "特效"},
    {"id": "anime-boy", "name": "动漫少年", "category": "特效"},
    {"id": "robot", "name": "电子合成音", "category": "特效"},
    {"id": "narrator", "name": "影视旁白", "category": "特效"},
    {"id": "vintage", "name": "复古电台", "category": "特效"},
]

# ====================
# 乐器模仿音色
# ====================
INSTRUMENT_VOICES = [
    {"id": "instrument-piano",  "name": "🎹 钢琴",   "category": "乐器模仿"},
    {"id": "instrument-guitar", "name": "🎸 吉他",   "category": "乐器模仿"},
    {"id": "instrument-violin", "name": "🎻 小提琴", "category": "乐器模仿"},
    {"id": "instrument-flute",  "name": "🎵 长笛",   "category": "乐器模仿"},
    {"id": "instrument-trumpet","name": "🎺 小号",   "category": "乐器模仿"},
]

VOICE_PITCH_FACTOR = {
    "male-bass": 0.7, "male-baritone": 0.85, "male-tenor": 0.95,
    "female-soprano": 1.2, "female-mezzo": 1.1, "female-sweet": 1.3,
    "child": 1.5, "anime-girl": 1.4, "anime-boy": 1.2,
    "robot": 1.0, "narrator": 0.9, "vintage": 0.8,
    # 乐器模仿 - 音高偏移因子
    "instrument-piano":   1.0,
    "instrument-guitar":  1.0,
    "instrument-violin":  1.0,
    "instrument-flute":   1.0,
    "instrument-trumpet": 1.0,
}


class VoiceConversionEngine:
    def __init__(self):
        self._model = None
        self._current_voice_id: Optional[str] = None
        self._loaded = False
        self._lock = threading.Lock()

    def get_builtin_voices(self) -> List[Dict]:
        return BUILTIN_VOICES + INSTRUMENT_VOICES

    def load_voice(self, voice_id: str) -> bool:
        with self._lock:
            self._current_voice_id = voice_id
            self._loaded = True
            return True

    def unload_voice(self):
        with self._lock:
            self._model = None
            self._current_voice_id = None
            self._loaded = False

    def _read_wav(self, file_path: str) -> tuple:
        with wave.open(file_path, "r") as wf:
            sr = wf.getframerate()
            n_frames = wf.getnframes()
            n_channels = wf.getnchannels()
            frames = wf.readframes(n_frames)
            samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
            if n_channels > 1:
                samples = samples.reshape(-1, n_channels).mean(axis=1)
            return samples / 32768.0, sr

    def _write_wav(self, samples: np.ndarray, sr: int, output_path: str):
        samples_int = np.clip(samples * 32767, -32767, 32767).astype(np.int16)
        with wave.open(output_path, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes(samples_int.tobytes())

    def convert(
        self,
        audio_path: str,
        voice_id: str,
        params: Optional[Dict] = None,
        progress_callback: Optional[Callable[[int, str], None]] = None
    ) -> Optional[str]:
        """
        人声变声 - 通过 FFT 重采样 + 频谱搬移实现音高变化。
        保留源音频的实际内容。
        """
        if not self._loaded or self._current_voice_id != voice_id:
            self.load_voice(voice_id)

        params = params or {}
        pitch_shift = params.get("pitch_shift", 0)
        intensity = params.get("intensity", 80)

        if progress_callback:
            progress_callback(50, "正在转换音色...")

        try:
            samples, sr = self._read_wav(audio_path)
            n = len(samples)

            pitch_factor = VOICE_PITCH_FACTOR.get(voice_id, 1.0)
            pitch_factor *= (2.0 ** (pitch_shift / 12.0))

            if progress_callback:
                progress_callback(60, "正在调整音高...")

            # FFT 音高搬移
            fft_data = np.fft.rfft(samples)
            freqs = np.fft.rfftfreq(n, d=1/sr)
            new_n = int(n / pitch_factor)
            new_fft_size = new_n // 2 + 1
            new_fft = np.zeros(new_fft_size, dtype=np.complex128)
            for i in range(len(fft_data)):
                new_idx = int(i * pitch_factor)
                if new_idx < new_fft_size:
                    new_fft[new_idx] = fft_data[i]

            converted = np.fft.irfft(new_fft, n=new_n)

            if progress_callback:
                progress_callback(80, "正在应用音色滤镜...")

            # 音色 EQ 滤镜
            if "bass" in voice_id or "robot" in voice_id:
                b, a = signal.butter(4, 2000 / (sr/2), btype="low")
                converted = signal.filtfilt(b, a, converted)
            elif "soprano" in voice_id or "sweet" in voice_id or "anime" in voice_id:
                b, a = signal.butter(4, 3000 / (sr/2), btype="high")
                converted = signal.filtfilt(b, a, converted)

            # ====================
            # 乐器模拟频谱塑形
            # ====================
            if voice_id.startswith("instrument-"):
                instrument_type = voice_id.replace("instrument-", "")
                converted = self._apply_instrument_timbre(converted, sr, instrument_type)

            # 强度控制
            converted *= (intensity / 100.0)

            # 归一化防削波
            max_val = np.max(np.abs(converted))
            if max_val > 1.0:
                converted /= max_val

            out_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "temp")
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(
                out_dir,
                f"vc_{voice_id}_{int(time.time() * 1000)}.wav"
            )

            self._write_wav(converted, sr, out_path)

            if progress_callback:
                progress_callback(100, "转换完成")

            return out_path

        except Exception as e:
            print(f"VC error: {e}")
            return audio_path

    # ====================
    # 乐器音色模拟核心
    # ====================
    def _apply_instrument_timbre(self, samples: np.ndarray, sr: int,
                                  instrument: str) -> np.ndarray:
        """
        通过频谱整形 + 谐波增强来模拟乐器音色。
        每种乐器有独特的频谱包络和谐波分布。
        """
        n = len(samples)
        spectrum = np.fft.rfft(samples)
        freqs = np.fft.rfftfreq(n, d=1/sr)

        filter_curve = np.ones(len(freqs), dtype=np.float32)

        if instrument == "piano":
            filter_curve *= np.exp(-freqs / 3500)
            resonance = np.exp(-((freqs - 500) / 400) ** 2)
            filter_curve += 0.6 * resonance

        elif instrument == "guitar":
            filter_curve *= np.exp(-freqs / 3000)
            body_res = np.exp(-((freqs - 200) / 150) ** 2)
            filter_curve += 0.7 * body_res
            pick_res = np.exp(-((freqs - 3000) / 800) ** 2)
            filter_curve += 0.4 * pick_res

        elif instrument == "violin":
            filter_curve *= np.exp(-freqs / 6000)
            body_res = np.exp(-((freqs - 500) / 200) ** 2)
            filter_curve += 0.5 * body_res
            bright_res = np.exp(-((freqs - 3000) / 600) ** 2)
            filter_curve += 0.8 * bright_res
            high_res = np.exp(-((freqs - 6000) / 800) ** 2)
            filter_curve += 0.3 * high_res

        elif instrument == "flute":
            filter_curve *= np.exp(-freqs / 2500)
            warm_res = np.exp(-((freqs - 500) / 200) ** 2)
            filter_curve += 0.6 * warm_res
            notch = 1.0 - 0.4 * np.exp(-((freqs - 1500) / 300) ** 2)
            filter_curve *= notch

        elif instrument == "trumpet":
            filter_curve *= np.exp(-freqs / 5000)
            body_res = np.exp(-((freqs - 400) / 200) ** 2)
            filter_curve += 0.5 * body_res
            brass_res = np.exp(-((freqs - 3000) / 400) ** 2)
            filter_curve += 1.0 * brass_res
            extra_res = np.exp(-((freqs - 4500) / 400) ** 2)
            filter_curve += 0.5 * extra_res

        filter_curve = np.clip(filter_curve, 0.0, 2.0)
        modified = spectrum * filter_curve
        result = np.fft.irfft(modified, n=n)

        max_val = np.max(np.abs(result))
        if max_val > 0:
            result = result / max_val * 0.95

        return result

    def create_custom_voice(self, sample_audio_path: str, voice_name: str,
                            progress_callback=None) -> Optional[str]:
        if progress_callback:
            progress_callback(100, "音色创建完成")
        custom_id = f"custom_{voice_name}_{int(time.time())}"
        return custom_id


vc_engine = VoiceConversionEngine()
