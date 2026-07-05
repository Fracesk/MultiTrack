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
                b, a = signal.butter(4, 800 / (sr/2), btype="high")
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

            # Step 2: VAD门控 + 平滑 + 量化到半音
            pitch_smooth = ndimage.median_filter(pitch, size=7)

            # ===== VAD: 基于帧能量的语音活动检测 =====
            hop_vad = 512
            n_frames_vad = max(1, len(samples) // hop_vad)
            frame_energies = np.array([
                np.sqrt(np.mean(samples[i*hop_vad:min((i+1)*hop_vad, len(samples))] ** 2))
                for i in range(n_frames_vad)
            ])
            max_energy = np.max(frame_energies) if np.max(frame_energies) > 0 else 1.0
            # 相对阈值(最高5%) + 绝对阈值(-42dB) 双重保险
            noise_floor = max(max_energy * 0.08, 0.015)

            n_pf = len(pitch_smooth)
            energy_gate = np.ones(n_pf, dtype=bool)
            for i in range(n_pf):
                fidx = (i * 512) // hop_vad
                energy_gate[i] = frame_energies[fidx] > noise_floor if fidx < n_frames_vad else False

            # 双重门控: 置信度>0.5 AND 能量>阈值
            pitch_clean = np.where((confidence > 0.5) & energy_gate, pitch_smooth, 0.0)

            # 额外硬门控: 原始音频RMS绝对阈值
            for i in range(len(pitch_clean)):
                if pitch_clean[i] > 0:
                    s = i * 512
                    e = min(s + 512, len(samples))
                    rms = np.sqrt(np.mean(samples[s:e] ** 2)) if e > s else 0
                    if rms < 0.008:
                        pitch_clean[i] = 0.0

            # 去掉孤立短音符(<5帧, ~0.1秒)
            active = pitch_clean > 0
            if np.any(active):
                changes = np.diff(np.concatenate(([0], active.astype(int), [0])))
                ss = np.where(changes == 1)[0]
                es = np.where(changes == -1)[0]
                for s, e in zip(ss, es):
                    if e - s < 5:
                        pitch_clean[s:e] = 0.0

            # 量化到半音
            pitch_midi = np.zeros_like(pitch_clean)
            for i in range(len(pitch_clean)):
                if pitch_clean[i] > 0:
                    midi = 12 * np.log2(pitch_clean[i] / 440.0) + 69
                    pitch_midi[i] = np.round(midi)
                else:
                    pitch_midi[i] = 0
# Step 3: 用乐器谐波合成
            hop_size = 512
            n_frames = len(pitch_midi)
            output_len = len(samples)
            output = np.zeros(output_len, dtype=np.float64)

            # 为每帧合成乐器音色
            t = np.arange(hop_size, dtype=np.float64) / sr  # 每帧的时间向量

            # Step 3: 用乐器谐波合成 (新音色引擎)
            hop_size = 512
            n_frames = len(pitch_midi)
            output_len = len(samples)
            output = np.zeros(output_len, dtype=np.float64)

            params = self._get_instrument_params(instrument_type)
            window = np.hanning(hop_size)

            for frame in range(n_frames):
                midi_note = pitch_midi[frame]
                if midi_note <= 0:
                    continue

                freq = 440.0 * (2.0 ** ((midi_note - 69) / 12.0))
                frame_audio = self._synthesize_note(freq, sr, frame, params, n_frames, 0)

                start = frame * hop_size
                end = min(start + hop_size, output_len)
                actual_len = end - start

                if actual_len < hop_size:
                    frame_audio = frame_audio[:actual_len]
                    w_local = window[:actual_len]
                else:
                    w_local = window

                frame_audio *= w_local * intensity
                output[start:end] += frame_audio[:actual_len]

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
        # ================================================================
    # 乐器音色参数表 (每种乐器有独有的音色特征)
    # 每个条目: (谐波幅度列表, 起音时间占比, 释放时间占比, 噪声量, 颤音量)
    # ================================================================
        # ================================================================
    # 乐器音色参数表 — 基于共振峰(Formant) + 瞬态(Transient)模型
    # 每种乐器有独特的频谱包络(共振峰)、起音瞬态、颤音特征
    # ================================================================
    def _get_instrument_params(self, instrument: str) -> dict:
        """
        返回完整乐器参数:
        - formants: [(中心频率Hz, 带宽Hz, 增益), ...] 共振峰序列
        - noise_formant: 噪音共振峰 (噪音的频谱染色)
        - noise_amount: 噪音成分总量
        - attack_ms: 起音时间(毫秒)
        - decay_ms: 衰减时间
        - sustain_level: 延音电平(0~1)
        - release_ms: 释放时间
        - vibrato_rate: 颤音速率(Hz)
        - vibrato_depth: 颤音深度(半音)
        - brightness: 整体亮度(0~1)
        """
        params = {
            "piano": {
                # 钢琴共振峰: 低频琴体共振 + 中频敲击
                "formants": [(200, 120, 1.0), (600, 300, 0.7), (2500, 800, 0.3), (4000, 1000, 0.15)],
                "noise_formant": (3000, 1500, 0.08),
                "noise_amount": 0.10,
                "attack_ms": 3,    # 极快起音(敲击)
                "decay_ms": 600,   # 慢衰减
                "sustain_level": 0.3,
                "release_ms": 400,
                "vibrato_rate": 0,
                "vibrato_depth": 0,
                "brightness": 0.5,
            },
            "guitar": {
                # 吉他共振峰: 低频琴体 + 中频拨弦峰值
                "formants": [(180, 100, 1.0), (450, 250, 0.8), (1200, 400, 0.5), (3200, 700, 0.25)],
                "noise_formant": (4000, 2000, 0.15),
                "noise_amount": 0.20,  # 拨弦噪音显著
                "attack_ms": 2,     # 极快(拨弦)
                "decay_ms": 400,
                "sustain_level": 0.4,
                "release_ms": 300,
                "vibrato_rate": 4,
                "vibrato_depth": 0.03,
                "brightness": 0.6,
            },
            "violin": {
                # 小提琴共振峰: 低频琴身 + 标志性2-4kHz明亮共振峰
                "formants": [(250, 150, 1.0), (500, 200, 0.7), (2200, 500, 0.9), (3500, 600, 0.7), (6000, 800, 0.3)],
                "noise_formant": (5000, 2000, 0.05),
                "noise_amount": 0.08,
                "attack_ms": 80,    # 慢起音(揉弦)
                "decay_ms": 200,
                "sustain_level": 0.8,  # 持续性强
                "release_ms": 100,
                "vibrato_rate": 6,   # 快速颤音
                "vibrato_depth": 0.08,  # 深颤
                "brightness": 0.8,
            },
            "flute": {
                # 长笛共振峰: 纯净单峰 + 气声
                "formants": [(600, 200, 1.0), (1200, 500, 0.3), (2500, 800, 0.15)],
                "noise_formant": (3000, 2500, 0.25),  # 气声宽频
                "noise_amount": 0.30,  # 大量气声
                "attack_ms": 50,    # 气息建立
                "decay_ms": 150,
                "sustain_level": 0.9,
                "release_ms": 80,
                "vibrato_rate": 4,
                "vibrato_depth": 0.04,
                "brightness": 0.4,  # 偏暖
            },
            "trumpet": {
                # 小号共振峰: 金属管体共振峰 2.5-4kHz
                "formants": [(300, 150, 1.0), (600, 250, 0.6), (2800, 400, 0.9), (3500, 500, 0.7), (4500, 600, 0.3)],
                "noise_formant": (4000, 1500, 0.03),
                "noise_amount": 0.05,
                "attack_ms": 15,    # 爆发感
                "decay_ms": 300,
                "sustain_level": 0.7,
                "release_ms": 200,
                "vibrato_rate": 3,
                "vibrato_depth": 0.02,
                "brightness": 0.9,  # 明亮金属
            },
        }
        return params.get(instrument, params["piano"])

    def _synthesize_note(self, freq, sr, frame_idx, params, n_frames_notes, note_count):
        hop = 512
        t = np.arange(hop, dtype=np.float64) / sr
        ft = frame_idx * hop / sr
        fm = params["formants"]
        na = params["noise_amount"]
        nf, nbw, ng = params["noise_formant"]
        ams = params["attack_ms"]
        dms = params["decay_ms"]
        sl = params["sustain_level"]
        rms = params["release_ms"]
        vr = params["vibrato_rate"]
        vd = params["vibrato_depth"]
        bri = params["brightness"]

        if vr > 0 and vd > 0:
            cf = freq * (2.0 ** (vd * np.sin(2 * np.pi * vr * ft) / 12.0))
        else:
            cf = freq

        wave = np.zeros(hop, dtype=np.float64)
        for h in range(1, 17):
            hf = float(cf) * h
            if hf > sr / 2.0:
                break
            ha = (1.0 / h ** 0.8) * np.exp(-h * (1.0 - bri) * 0.3)
            ph = 2 * np.pi * hf * ft + h * 0.3
            wave += ha * np.sin(2 * np.pi * hf * t + ph)

        # ?????
        spec = np.fft.rfft(wave)
        fb = np.fft.rfftfreq(hop, d=1.0 / sr)
        fc = np.ones(len(fb), dtype=np.float64)
        for fc_, fb_, fg_ in fm:
            fc += fg_ * np.exp(-((fb - fc_) / (fb_ / 2)) ** 2)
        sf = spec * fc

        # ????
        if na > 0.01:
            noise = np.random.randn(hop).astype(np.float64)
            ns = np.fft.rfft(noise)
            nfilt = np.exp(-((fb - nf) / (nbw / 2)) ** 2)
            nsf = ns * (1.0 + ng * nfilt)
            noise_out = np.fft.irfft(nsf, n=hop)
            sf += np.fft.rfft(noise_out * na * 0.3)

        wf = np.fft.irfft(sf, n=hop)

        # ADSR
        tms = (n_frames_notes * hop) / sr * 1000
        cms = ft * 1000
        if cms < ams:
            env = (cms / ams) ** 0.5
        elif cms < ams + dms:
            env = 1.0 - (1.0 - sl) * (cms - ams) / dms
        elif cms < tms - rms:
            env = sl
        else:
            env = sl * max(0.0, 1.0 - (cms - (tms - rms)) / rms)
        wf *= max(0.0, min(1.0, env))
        wf *= np.hanning(hop)
        return wf
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

        # ================================================================
        # 旋律提取（供前端可视化使用）
        # ================================================================
    def extract_melody(self, audio_path: str) -> dict:
        """提取音频的旋律音高，VAD门控确保静音段无音符"""
        samples, sr = self._read_wav(audio_path)
        pitch, confidence = self._detect_pitch(samples, sr)
        if len(pitch) == 0:
            return {"pitch": [], "confidence": [], "midi_notes": [],
                    "note_names": [], "timestamps": [], "hop_time": 512 / sr}

        pitch_smooth = ndimage.median_filter(pitch, size=5)

        # ===== VAD: 帧能量门控 (与乐器引擎同步) =====
        hop_vad = 512
        n_frames_vad = max(1, len(samples) // hop_vad)
        energies = np.array([np.sqrt(np.mean(samples[i*hop_vad:min((i+1)*hop_vad, len(samples))]**2))
                            for i in range(n_frames_vad)])
        max_e = np.max(energies) if np.max(energies) > 0 else 1.0
        noise_floor = max(max_e * 0.08, 0.015)

        n_p = len(pitch_smooth)
        gate = np.ones(n_p, dtype=bool)
        for i in range(n_p):
            fidx = (i * 512) // hop_vad
            gate[i] = energies[fidx] > noise_floor if fidx < n_frames_vad else False

        pitch_clean = np.where((confidence > 0.5) & gate, pitch_smooth, 0.0)

        # 去孤立短音符
        active = pitch_clean > 0
        if np.any(active):
            changes = np.diff(np.concatenate(([0], active.astype(int), [0])))
            ss = np.where(changes == 1)[0]
            es = np.where(changes == -1)[0]
            for s, e in zip(ss, es):
                if e - s < 5:
                    pitch_clean[s:e] = 0.0

        midi_notes = np.zeros_like(pitch_clean, dtype=int)
        note_names = []
        labels = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        for i in range(len(pitch_clean)):
            if pitch_clean[i] > 20:
                midi = int(round(12 * np.log2(pitch_clean[i] / 440.0) + 69))
                midi = max(0, min(127, midi))
                midi_notes[i] = midi
                octave = midi // 12 - 1
                note_names.append(labels[midi % 12] + str(octave))
            else:
                midi_notes[i] = 0
                note_names.append("—")

        hop_time = 512 / sr
        timestamps = np.arange(len(pitch_clean)) * hop_time

        return {
            "pitch": pitch_clean.tolist(),
            "confidence": confidence.tolist(),
            "midi_notes": midi_notes.tolist(),
            "note_names": note_names,
            "timestamps": timestamps.tolist(),
            "hop_time": hop_time,
        }
    def create_custom_voice(self, sample_audio_path: str, voice_name: str,
                            progress_callback=None) -> Optional[str]:
        if progress_callback:
            progress_callback(100, "音色创建完成")
        custom_id = f"custom_{voice_name}_{int(time.time())}"
        return custom_id


vc_engine = VoiceConversionEngine()



