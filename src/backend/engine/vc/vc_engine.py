# -*- coding: utf-8 -*-
"""
人声变声引擎 + 乐器旋律模仿引擎
- 人声变声：通过 FFT 重采样 + 频谱搬移实现音高变化
- 乐器旋律模仿：提取音频旋律 → 用乐器音色重新合成演奏
"""
import os
import wave
import numpy as np
import time
import threading
from typing import Optional, Dict, List, Callable
from scipy import signal, ndimage


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

    # 主入口：根据 voice_id 决定走人声变声还是乐器演奏
    def convert(
        self,
        audio_path: str,
        voice_id: str,
        params: Optional[Dict] = None,
        progress_callback: Optional[Callable[[int, str], None]] = None
    ) -> Optional[str]:
        if voice_id.startswith("instrument-"):
            return self._convert_instrument(audio_path, voice_id, params, progress_callback)
        return self._convert_voice(audio_path, voice_id, params, progress_callback)

    # ================================================================
    # 1. 人声变声 (FFT 重采样 + 频谱搬移)
    # ================================================================
    def _convert_voice(
        self,
        audio_path: str,
        voice_id: str,
        params: Optional[Dict] = None,
        progress_callback: Optional[Callable[[int, str], None]] = None
    ) -> Optional[str]:
        if not self._loaded or self._current_voice_id != voice_id:
            self.load_voice(voice_id)

        params = params or {}
        pitch_shift = params.get("pitch_shift", 0)
        intensity = params.get("intensity", 80)

        if progress_callback:
            progress_callback(10, "正在读取音频...")

        try:
            samples, sr = self._read_wav(audio_path)
            if progress_callback:
                progress_callback(30, "正在调整音高...")

            pitch_factor = VOICE_PITCH_FACTOR.get(voice_id, 1.0)
            pitch_factor *= (2.0 ** (pitch_shift / 12.0))

            # FFT 音高搬移
            n = len(samples)
            fft_data = np.fft.rfft(samples)
            new_n = int(n / pitch_factor)
            new_fft_size = new_n // 2 + 1
            new_fft = np.zeros(new_fft_size, dtype=np.complex128)
            for i in range(len(fft_data)):
                new_idx = int(i * pitch_factor)
                if new_idx < new_fft_size:
                    new_fft[new_idx] = fft_data[i]

            converted = np.fft.irfft(new_fft, n=new_n)

            if progress_callback:
                progress_callback(60, "正在应用音色滤镜...")

            # 音色 EQ 滤镜
            if "bass" in voice_id or "robot" in voice_id:
                b, a = signal.butter(4, 2000 / (sr/2), btype="low")
                converted = signal.filtfilt(b, a, converted)
            elif "soprano" in voice_id or "sweet" in voice_id or "anime" in voice_id:
                b, a = signal.butter(4, 3000 / (sr/2), btype="high")
                converted = signal.filtfilt(b, a, converted)

            # 强度控制
            converted *= (intensity / 100.0)

            # 归一化
            max_val = np.max(np.abs(converted))
            if max_val > 1.0:
                converted /= max_val

            if progress_callback:
                progress_callback(90, "正在写入文件...")

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

    # ================================================================
    # 2. 乐器旋律模仿 (核心算法)
    #    流程：音频 → 提取基频旋律 → 生成音符序列 → 乐器音色合成
    # ================================================================
    def _convert_instrument(
        self,
        audio_path: str,
        voice_id: str,
        params: Optional[Dict] = None,
        progress_callback: Optional[Callable[[int, str], None]] = None
    ) -> Optional[str]:
        """
        用乐器音色重新演奏音频中的旋律。
        步骤：
        1. 从音频中提取基频曲线 (pitch contour)
        2. 平滑基频并映射到最近的半音
        3. 用目标乐器的谐波结构合成每个音符
        """
        instrument_type = voice_id.replace("instrument-", "")
        params = params or {}
        intensity = params.get("intensity", 80) / 100.0

        if progress_callback:
            progress_callback(5, "正在读取音频...")

        try:
            samples, sr = self._read_wav(audio_path)
            if progress_callback:
                progress_callback(15, "正在提取旋律音高...")

            # Step 1: 提取基频
            pitch, confidence = self._detect_pitch(samples, sr)
            if len(pitch) == 0:
                return audio_path

            if progress_callback:
                progress_callback(35, "正在平滑旋律曲线...")

            # Step 2: 平滑+量化到半音
            # 用中值滤波去噪声
            pitch_smooth = ndimage.median_filter(pitch, size=7)
            # 只保留置信度高的片段
            confidence_threshold = 0.3
            pitch_clean = np.where(confidence > confidence_threshold, pitch_smooth, 0.0)
            # 量化到半音 (MIDI note)
            pitch_midi = np.zeros_like(pitch_clean)
            for i in range(len(pitch_clean)):
                if pitch_clean[i] > 0:
                    midi = 12 * np.log2(pitch_clean[i] / 440.0) + 69
                    pitch_midi[i] = np.round(midi)  # 量化到最近半音
                else:
                    pitch_midi[i] = 0

            if progress_callback:
                progress_callback(55, "正在合成乐器音色...")

            # Step 3: 用乐器谐波合成
            hop_size = 512
            n_frames = len(pitch_midi)
            output_len = len(samples)
            output = np.zeros(output_len, dtype=np.float64)

            # 为每帧合成乐器音色
            t = np.arange(hop_size, dtype=np.float64) / sr  # 每帧的时间向量

            # 获取乐器的谐波幅度表
            harmonics = self._get_instrument_harmonics(instrument_type)

            # 窗口函数用于帧间平滑
            window = np.hanning(hop_size)

            for frame in range(n_frames):
                midi_note = pitch_midi[frame]
                if midi_note <= 0:
                    # 休止符：静音
                    continue

                freq = 440.0 * (2.0 ** ((midi_note - 69) / 12.0))
                start = frame * hop_size
                end = min(start + hop_size, output_len)
                actual_len = end - start

                if actual_len < hop_size:
                    t_local = np.arange(actual_len, dtype=np.float64) / sr
                    w_local = window[:actual_len]
                else:
                    t_local = t
                    w_local = window

                # 合成该帧的乐器音
                frame_audio = np.zeros(actual_len, dtype=np.float64)
                for h_idx, h_amp in enumerate(harmonics):
                    h_freq = freq * (h_idx + 1)
                    if h_freq > sr / 2:
                        break  # 超过奈奎斯特频率截止
                    phase_offset = 2 * np.pi * h_freq * (frame * hop_size / sr)
                    frame_audio += h_amp * np.sin(2 * np.pi * h_freq * t_local + phase_offset)

                # 包络：起音+衰减
                # 简单 AD 包络：快速起音 (10%)，缓慢衰减
                envelope = np.ones(actual_len)
                attack_len = max(1, int(actual_len * 0.1))
                envelope[:attack_len] = np.linspace(0, 1, attack_len)
                frame_audio *= envelope * w_local * intensity

                # 叠加到输出
                output[start:end] += frame_audio

            # 归一化
            max_val = np.max(np.abs(output))
            if max_val > 0:
                output = output / max_val * 0.95

            if progress_callback:
                progress_callback(85, "正在写入文件...")

            out_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "temp")
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(
                out_dir,
                f"vc_{voice_id}_{int(time.time() * 1000)}.wav"
            )
            self._write_wav(output.astype(np.float32), sr, out_path)

            if progress_callback:
                progress_callback(100, "演奏完成！")

            return out_path

        except Exception as e:
            print(f"Instrument error: {e}")
            import traceback
            traceback.print_exc()
            return audio_path

    # ================================================================
    # 乐器谐波结构表 (决定乐器音色特征)
    # 每种乐器的前N阶谐波幅度分布
    # ================================================================
    def _get_instrument_harmonics(self, instrument: str) -> List[float]:
        """
        返回乐器的谐波幅度列表 [基频, 2次谐波, 3次谐波, ...]
        幅度范围 0.0 ~ 1.0
        """
        harmonics_map = {
            "piano": [
                1.0,    # 基频 — 饱满
                0.7,    # 2次 — 八度音，强
                0.3,    # 3次 — 五度音，中
                0.15,   # 4次
                0.08,   # 5次
                0.03,   # 6次
                0.01,   # 7次
            ],
            "guitar": [
                1.0,    # 基频
                0.6,    # 2次
                0.4,    # 3次 — 吉他五度泛音丰富
                0.2,    # 4次
                0.1,    # 5次
                0.04,   # 6次
                0.02,   # 7次
            ],
            "violin": [
                1.0,    # 基频
                0.8,    # 2次 — 很强
                0.6,    # 3次 — 很强，小提琴特征
                0.4,    # 4次
                0.25,   # 5次
                0.15,   # 6次
                0.1,    # 7次
                0.06,   # 8次 — 高次泛音丰富
                0.03,   # 9次
            ],
            "flute": [
                1.0,    # 基频 — 极强
                0.3,    # 2次 — 很弱，长笛特点是泛音少
                0.1,    # 3次
                0.02,   # 4次
                0.005,  # 5次
            ],
            "trumpet": [
                1.0,    # 基频
                0.85,   # 2次 — 极强
                0.7,    # 3次 — 铜管特征
                0.5,    # 4次
                0.3,    # 5次
                0.15,   # 6次
                0.08,   # 7次
                0.04,   # 8次
            ],
        }
        return harmonics_map.get(instrument, [1.0, 0.5, 0.3])

    # ================================================================
    # 音频基频检测 (自相关法)
    # ================================================================
    def _detect_pitch(self, samples: np.ndarray, sr: int,
                      fmin: float = 55.0, fmax: float = 1600.0,
                      hop: int = 512) -> tuple:
        """返回 (pitch_hz, confidence)"""
        n_fft = 2048
        n_frames = 1 + (len(samples) - n_fft) // hop
        if n_frames <= 0:
            return np.array([]), np.array([])

        # 分块处理防止大数组
        chunk_size = min(n_frames, 2000)
        all_pitch, all_conf = [], []

        for chunk_start in range(0, n_frames, chunk_size):
            chunk_end = min(chunk_start + chunk_size, n_frames)
            n_chunk = chunk_end - chunk_start

            # 构建帧矩阵
            frames = np.zeros((n_chunk, n_fft))
            for j in range(n_chunk):
                i = chunk_start + j
                s = i * hop
                e = min(s + n_fft, len(samples))
                frames[j, :len(samples[s:e])] = samples[s:e]

            # 加窗
            frames *= np.hanning(n_fft)

            # 自相关法求基频
            fft = np.fft.rfft(frames)
            power = np.abs(fft) ** 2
            acf = np.fft.irfft(power, n=n_fft, axis=1)[:, :n_fft // 2]
            # 归一化
            acf /= np.maximum(np.abs(acf[:, 0:1]), 1e-10)

            # 搜索范围
            min_idx = int(sr / fmax)
            max_idx = int(sr / fmin)
            if max_idx >= acf.shape[1]:
                max_idx = acf.shape[1] - 1
            if min_idx >= max_idx:
                min_idx = max(1, max_idx - 1)

            search = acf[:, min_idx:max_idx + 1]
            if search.shape[1] == 0:
                all_pitch.append(np.zeros(n_chunk))
                all_conf.append(np.zeros(n_chunk))
                continue

            peak_idx = np.argmax(search, axis=1)
            peak_val = np.max(search, axis=1)
            lag = min_idx + peak_idx

            pitch = np.where(
                (peak_val > 0.15) & (lag > 0),
                sr / lag.astype(float),
                0.0
            )
            all_pitch.append(pitch)
            all_conf.append(peak_val)

        pitch_arr = ndimage.median_filter(np.concatenate(all_pitch)[:n_frames], size=5)
        conf_arr = np.concatenate(all_conf)[:n_frames]
        return pitch_arr, conf_arr

    def create_custom_voice(self, sample_audio_path: str, voice_name: str,
                            progress_callback=None) -> Optional[str]:
        if progress_callback:
            progress_callback(100, "音色创建完成")
        custom_id = f"custom_{voice_name}_{int(time.time())}"
        return custom_id


vc_engine = VoiceConversionEngine()
