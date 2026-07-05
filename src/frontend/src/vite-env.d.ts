/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    selectAudioFile: () => Promise<string | null>;
    selectExportDir: () => Promise<string | null>;
    send: (channel: string, data: any) => void;
    on: (channel: string, callback: (...args: any[]) => void) => void;
  };
}
