import React, { useRef, useEffect, useState, useCallback } from "react";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

interface SpectrogramViewerProps {
  data: number[][] | null;
  frequencies: number[];
  pitch?: number[];
  chroma?: number[][];
  noteNames?: string[];
  height?: number;
  maxFreq?: number;
  label?: string;
  currentTime?: number;
  duration?: number;
}

const SpectrogramViewer: React.FC<SpectrogramViewerProps> = ({
  data, frequencies, pitch, chroma, noteNames,
  height = 260, maxFreq = 8000, label = "频谱图",
  currentTime, duration,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverInfo, setHoverInfo] = useState<{ freq: number; time: number; note: string } | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);

  // Resize
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.contentRect.width > 0) {
          setCanvasWidth(Math.max(400, Math.floor(e.contentRect.width)));
        }
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 布局: 左轴(40px) + 主图 + 右轴(18px chroma)
    const axisW = 40;
    const chromaW = 16;
    const graphW = canvas.width - axisW - chromaW;
    const graphH = canvas.height - 28;

    // --- Clear background ---
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const nFreq = data.length;
    const nTime = data[0]?.length || 1;
    const logMin = Math.log2(Math.max(27.5, 1));
    const logMax = Math.log2(maxFreq);
    const logRange = logMax - logMin;

    // ---- Draw Spectrogram ----
    const imgData = ctx.createImageData(graphW, graphH);
    for (let x = 0; x < graphW; x++) {
      const tIdx = Math.floor((x / graphW) * nTime);
      for (let y = 0; y < graphH; y++) {
        const frac = 1 - y / graphH;
        const freqLog = Math.pow(2, logMin + frac * logRange);

        let fIdx = 0;
        for (let i = 0; i < frequencies.length; i++) {
          if (frequencies[i] <= freqLog) fIdx = i;
          else break;
        }
        fIdx = Math.min(fIdx, nFreq - 1);

        const val = data[fIdx]?.[tIdx] ?? -80;
        const norm = Math.max(0, Math.min(1, (val + 80) / 80));

        // Beautiful colormap: dark blue -> cyan -> yellow -> red
        let r, g, b;
        if (norm < 0.15) {
          // 黑色到深蓝
          const t = norm / 0.15;
          r = 0; g = Math.floor(t * 30); b = Math.floor(t * 80 + 20);
        } else if (norm < 0.35) {
          // 深蓝到青
          const t = (norm - 0.15) / 0.2;
          r = 0; g = Math.floor(30 + t * 170); b = Math.floor(100 + t * 155);
        } else if (norm < 0.55) {
          // 青到黄绿
          const t = (norm - 0.35) / 0.2;
          r = Math.floor(t * 200); g = 200 + Math.floor(t * 55); b = Math.floor((1 - t) * 255);
        } else if (norm < 0.75) {
          // 黄绿到橙
          const t = (norm - 0.55) / 0.2;
          r = Math.floor(200 + t * 55); g = Math.floor((1 - t) * 200); b = 0;
        } else {
          // 橙到亮红
          const t = (norm - 0.75) / 0.25;
          r = 255; g = Math.floor((1 - t) * 100); b = 0;
        }

        const idx = (y * graphW + x) * 4;
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, axisW, 0);

    // ---- Draw frequency axis labels (12-tone scale) ----
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const PITCH_CLASS_COLORS = [
      "#ff4444", "#ff6644", "#ffaa00", "#ffcc00",
      "#aadd00", "#44cc44", "#00cc88", "#00aaaa",
      "#4488ff", "#6666ff", "#aa44ff", "#cc44aa",
    ];

    const minMidi = 33;
    const maxMidi = Math.min(127, Math.ceil(12 * Math.log2(maxFreq / 440) + 69));
    const whiteKeyNotes = [0, 2, 4, 5, 7, 9, 11];

    // 只画白键（C D E F G A B）避免标签过密
    for (let midi = minMidi; midi <= maxMidi; midi++) {
      const freq = midiToFreq(midi);
      if (freq > maxFreq) break;

      const noteClass = midi % 12;
      if (!whiteKeyNotes.includes(noteClass)) continue;

      const frac = Math.log2(freq / 27.5) / logRange;
      const y = graphH - frac * graphH;

      if (y < 0 || y > graphH) continue;

      const octave = Math.floor(midi / 12) - 1;
      const noteName = NOTE_NAMES[noteClass] + octave;

      // Very subtle tick
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(axisW, y);
      ctx.lineTo(canvas.width - chromaW, y);
      ctx.stroke();

      // Note label
      ctx.fillStyle = PITCH_CLASS_COLORS[noteClass];
      ctx.fillText(noteName, axisW - 4, y);
    }

    // ---- Draw pitch contour (if available) ----
    if (pitch && pitch.length > 0) {
      ctx.strokeStyle = "rgba(0, 255, 170, 0.7)";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(0, 255, 170, 0.4)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < pitch.length; i++) {
        if (pitch[i] <= 0) continue;
        const fracPitch = Math.log2(pitch[i] / 27.5) / logRange;
        const y = graphH - fracPitch * graphH;
        const px = axisW + (i / pitch.length) * graphW;
        if (!started) { ctx.moveTo(px, y); started = true; }
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Label for pitch contour
      ctx.fillStyle = "rgba(0, 255, 170, 0.6)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("旋律线", axisW + graphW - 4, 14);
    }

    // ---- Draw time labels ----
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#ffffff66";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const totalSec = duration || 30;
    const timeInterval = Math.max(1, Math.pow(10, Math.floor(Math.log10(totalSec / 6))));
    for (let t = 0; t <= totalSec; t += timeInterval) {
      const x = axisW + (t / totalSec) * graphW;
      ctx.fillText(t + "s", x, graphH + 6);
    }

    // ---- Playback cursor ----
    if (currentTime !== undefined && duration && duration > 0) {
      const frac = currentTime / duration;
      const cx = axisW + frac * graphW;
      ctx.strokeStyle = "#00ffaa";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#00ffaa66";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, graphH);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Cursor diamond
      ctx.fillStyle = "#00ffaa";
      ctx.beginPath();
      ctx.moveTo(cx, 2);
      ctx.lineTo(cx + 5, 8);
      ctx.lineTo(cx, 14);
      ctx.lineTo(cx - 5, 8);
      ctx.closePath();
      ctx.fill();
    }

    // ---- Chroma bar (right side) ----
    if (chroma && chroma.length === 12) {
      const rx = canvas.width - chromaW + 1;
      const noteHeight = graphH / 12;

      for (let n = 0; n < 12; n++) {
        const ny = n * noteHeight;
        const avgVal = Math.min(1, chroma[n].reduce((a, b) => a + b, 0) / chroma[n].length * 2);
        ctx.fillStyle = PITCH_CLASS_COLORS[n];
        ctx.globalAlpha = Math.max(0.1, avgVal);
        ctx.fillRect(rx, ny, chromaW - 2, noteHeight - 1);
        ctx.globalAlpha = 1;
      }
    }
  }, [data, frequencies, pitch, chroma, maxFreq, height, currentTime, duration, canvasWidth]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const axisW = 40;
    const chromaW = 16;
    const graphW = canvasRef.current.width - axisW - chromaW;
    const graphH = canvasRef.current.height - 28;

    const x = mx - axisW;
    if (x < 0 || x > graphW || my < 0 || my > graphH) {
      setHoverInfo(null);
      return;
    }

    const nTime = data[0]?.length || 1;
    const tIdx = Math.floor((x / graphW) * nTime);

    const logMin = Math.log2(27.5);
    const logMax = Math.log2(maxFreq);
    const logRange = logMax - logMin;
    const frac = 1 - my / graphH;
    const freqLog = Math.pow(2, logMin + frac * logRange);

    const midi = 12 * Math.log2(freqLog / 440) + 69;
    const noteClass = Math.round(midi) % 12;
    const octave = Math.floor(Math.round(midi) / 12) - 1;
    const noteName = NOTE_NAMES[noteClass] + octave;

    const totalSec = duration || 30;
    const timeSec = (tIdx / nTime) * totalSec;

    setHoverInfo({ freq: Math.round(freqLog), time: timeSec, note: noteName });
  }, [data, frequencies, maxFreq, duration]);

  if (!data) {
    return (
      <div style={{
        height, background: "#0d1117", borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#555", fontSize: 13, flexDirection: "column", gap: 8,
      }}>
        <span style={{ fontSize: 28 }}>🎵</span>
        <span>加载频谱图中...</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: "#999", fontWeight: 500 }}>
          {label || "频谱图"}
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#666" }}>
          <span>🎯 鼠标悬停查看音高</span>
          <span>⏱️ 移动进度条跟播</span>
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={height}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
          style={{
            width: "100%", height,
            borderRadius: 8, cursor: "crosshair",
            background: "#0d1117", display: "block",
          }}
        />
        {hoverInfo && (
          <div style={{
            position: "absolute", bottom: 6, right: 8,
            fontSize: 11, color: "rgba(255,255,255,0.85)",
            background: "rgba(0,0,0,0.75)", padding: "4px 10px",
            borderRadius: 6, whiteSpace: "nowrap",
            backdropFilter: "blur(4px)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            <span style={{ color: "#00ffaa", fontWeight: "bold" }}>{hoverInfo.note}</span>
            {" | "}
            {hoverInfo.freq >= 1000
              ? (hoverInfo.freq / 1000).toFixed(1) + " kHz"
              : hoverInfo.freq + " Hz"}
            {" | "}
            {Math.floor(hoverInfo.time / 60)}:{String(Math.floor(hoverInfo.time % 60)).padStart(2, "0")}
          </div>
        )}
      </div>
    </div>
  );
};

export default SpectrogramViewer;
