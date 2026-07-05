import { create } from 'zustand';

export interface AudioFile {
  name: string;
  path: string;
  size: number;
  duration: number;
  sampleRate: number;
  channels: number;
  format: string;
  fileObj?: File;  // 保存真实文件对象
  uploadedPath?: string; // 上传到后端后的服务端路径
}

export interface StemTrack {
  id: string;
  name: string;
  type: 'vocals' | 'accompaniment' | 'bass' | 'drums' | 'other' | 'piano';
  filePath: string;  // 后端返回的本地路径
  downloadUrl: string; // 可播放的 URL
  duration: number;
  active: boolean;
  volume: number;
  pan: number;
}

export interface VoicePreset {
  id: string;
  name: string;
  category: string;
  isBuiltin: boolean;
  previewAudioPath?: string;
}

export interface ExportConfig {
  format: 'wav' | 'mp3' | 'flac';
  bitrate: number;
  includeStems: boolean;
  outputDir: string;
}

interface AppState {
  currentStep: number;
  audioFile: AudioFile | null;
  stems: StemTrack[];
  selectedVoice: VoicePreset | null;
  convertedVocalsPath: string | null;
  voiceParams: { pitchShift: number; formantShift: number; intensity: number; };
  exportConfig: ExportConfig;
  processing: boolean;
  processingProgress: number;
  processingStatus: string;

  setCurrentStep: (step: number) => void;
  setAudioFile: (file: AudioFile | null) => void;
  setStems: (stems: StemTrack[]) => void;
  updateStem: (id: string, updates: Partial<StemTrack>) => void;
  setSelectedVoice: (voice: VoicePreset | null) => void;
  setConvertedVocalsPath: (path: string | null) => void;
  setVoiceParams: (params: Partial<AppState["voiceParams"]>) => void;
  setExportConfig: (config: Partial<ExportConfig>) => void;
  setProcessing: (processing: boolean) => void;
  setProcessingProgress: (progress: number, status: string) => void;
  reset: () => void;
}

const initialState = {
  currentStep: 0,
  audioFile: null,
  stems: [],
  selectedVoice: null,
  convertedVocalsPath: null,
  voiceParams: { pitchShift: 0, formantShift: 0, intensity: 80 },
  exportConfig: { format: 'mp3' as const, bitrate: 320, includeStems: false, outputDir: '' },
  processing: false,
  processingProgress: 0,
  processingStatus: '',
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,
  setCurrentStep: (step) => set({ currentStep: step }),
  setAudioFile: (file) => set({ audioFile: file }),
  setStems: (stems) => set({ stems }),
  updateStem: (id, updates) => set((state) => ({
    stems: state.stems.map((s) => (s.id === id ? { ...s, ...updates } : s)),
  })),
  setSelectedVoice: (voice) => set({ selectedVoice: voice }),
  setConvertedVocalsPath: (path) => set({ convertedVocalsPath: path }),
  setVoiceParams: (params) => set((state) => ({ voiceParams: { ...state.voiceParams, ...params } })),
  setExportConfig: (config) => set((state) => ({ exportConfig: { ...state.exportConfig, ...config } })),
  setProcessing: (processing) => set({ processing }),
  setProcessingProgress: (progress, status) => set({ processingProgress: progress, processingStatus: status }),
  reset: () => set(initialState),
}));
