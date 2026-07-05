import { useRef, useState, useCallback } from "react";

export interface AudioPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
  });

  const play = useCallback((url: string) => {
    // Stop current
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(url);
    audio.volume = state.volume;

    audio.onloadedmetadata = () => {
      setState((prev) => ({ ...prev, duration: audio.duration }));
    };

    audio.ontimeupdate = () => {
      setState((prev) => ({ ...prev, currentTime: audio.currentTime }));
    };

    audio.onended = () => {
      setState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
    };

    audio.onerror = () => {
      console.error("Audio playback error:", audio.error?.message || "unknown error", "url:", url);
      setState((prev) => ({ ...prev, isPlaying: false }));
    };

    audioRef.current = audio;
    audio.play().then(() => {
      setState((prev) => ({ ...prev, isPlaying: true }));
    }).catch((err) => {
      console.error("Play failed:", err.message);
      setState((prev) => ({ ...prev, isPlaying: false }));
    });
  }, [state.volume]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setState((prev) => ({ ...prev, isPlaying: false }));
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 }));
    }
  }, []);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setState((prev) => ({ ...prev, currentTime: time }));
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    const v = Math.max(0, Math.min(1, vol));
    if (audioRef.current) {
      audioRef.current.volume = v;
    }
    setState((prev) => ({ ...prev, volume: v }));
  }, []);

  return { ...state, play, pause, stop, seek, setVolume };
}
