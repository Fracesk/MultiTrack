import axios from "axios";

const API_BASE = "http://127.0.0.1:8756";

const api = axios.create({
  baseURL: API_BASE,
  timeout: 300000,
});

export interface VoiceInfo {
  id: string;
  name: string;
  category: string;
}

export interface StemsResult {
  [stemType: string]: {
    path: string;
    url: string;
    stem_id: string;
  };
}

export interface SpectrogramData {
  spectrogram: number[][];
  frequencies: number[];
  time_frames: number;
  sample_rate: number;
  pitch: number[];
  confidence?: number[];
  max_freq: number;
  chroma?: number[][];
  note_names?: string[];
  duration_sec?: number;
  hop_ms?: number;
}

export async function fetchHealth() {
  const res = await api.get("/api/health");
  return res.data;
}

export async function uploadAudio(
  file: File
): Promise<{ status: string; path: string; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post("/api/upload", form, { timeout: 300000 });
  return res.data;
}

export async function fetchVoices(): Promise<{ builtin: VoiceInfo[]; custom: any[] }> {
  const res = await api.get("/api/voices");
  return res.data;
}

export async function separateAudio(
  file: File,
  mode: string = "2stems"
): Promise<{ status: string; stems: StemsResult; audio_info: any }> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  const res = await api.post("/api/separate", form, { timeout: 600000 });
  return res.data;
}

export async function getSpectrogram(
  file: File,
  maxFreq: number = 8000
): Promise<SpectrogramData> {
  const form = new FormData();
  form.append("file", file);
  form.append("max_freq", String(maxFreq));
  const res = await api.post("/api/spectrogram", form, { timeout: 120000 });
  return res.data;
}

export async function getSpectrogramByPath(
  audioPath: string,
  maxFreq: number = 8000
): Promise<SpectrogramData> {
  const res = await api.get("/api/spectrogram", {
    params: { audio_path: audioPath, max_freq: maxFreq }
  });
  return res.data;
}

export async function convertVoice(
  audioPath: string,
  voiceId: string,
  pitchShift: number = 0,
  intensity: number = 80
): Promise<{ status: string; path: string; url: string }> {
  const form = new FormData();
  form.append("audio_path", audioPath);
  form.append("voice_id", voiceId);
  form.append("pitch_shift", String(pitchShift));
  form.append("intensity", String(intensity));
  const res = await api.post("/api/convert", form);
  return res.data;
}

export function getAudioUrl(path: string): string {
  return `${API_BASE}/api/audio/${encodeURIComponent(path.split("/").pop() || "")}`;
}

export async function processPipeline(
  file: File,
  mode: string = "2stems",
  voice_id?: string,
  voice_params: string = "{}",
  export_format: string = "mp3",
  export_bitrate: number = 320,
  include_stems: boolean = false,
  stem_config: string = "{}"
): Promise<{ status: string; export_path: string; message: string; stem_paths?: Record<string, string> }> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", mode);
  form.append("export_format", export_format);
  form.append("export_bitrate", String(export_bitrate));
  form.append("include_stems", String(include_stems));
  form.append("voice_params", voice_params);
  form.append("stem_config", stem_config);
  if (voice_id) form.append("voice_id", voice_id);
  const res = await api.post("/api/process", form);
  return res.data;
}

export default api;


