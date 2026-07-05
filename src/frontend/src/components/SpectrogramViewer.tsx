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
  /** 乐器模式：显示旋律音符提取结果 */
  melodyNotes?: { midi: number; name: string; time: number }[];
}

const SpectrogramViewer: React.FC<SpectrogramViewerProps> = ({
  data, frequencies, pitch, chroma, noteNames,
  height = 220, maxFreq = 8000, label = "频谱图",
  currentTime, duration, melodyNotes,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverInfo, setHoverInfo] = useState<{ freq: number; time: number; note: string } | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);

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
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const axisW = 36;
    const graphW = canvas.width - axisW;
    const graphH = canvas.height - 24;

    // 背景
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ---- 如果有频谱数据则绘制 ----
    if (data && data.length > 0) {
      const nFreq = data.length;
      const nTime = data[0]?.length || 1;
      const logMin = Math.log2(Math.max(27.5, 1));
      const logMax = Math.log2(maxFreq);
      const logRange = logMax - logMin;

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
          let r = 0, g = 0, b = 0;
          if (norm < 0.15) { r = 0; g = Math.floor(norm / 0.15 * 30); b = Math.floor(norm / 0.15 * 80 + 20); }
          else if (norm < 0.35) { const t = (norm - 0.15) / 0.2; r = 0; g = 30 + t * 170; b = 100 + t * 155; }
          else if (norm < 0.55) { const t = (norm - 0.35) / 0.2; r = t * 200; g = 200 + t * 55; b = (1 - t) * 255; }
          else if (norm < 0.75) { const t = (norm - 0.55) / 0.2; r = 200 + t * 55; g = (1 - t) * 200; b = 0; }
          else { const t = (norm - 0.75) / 0.25; r = 255; g = (1 - t) * 100; b = 0; }
          const idx = (y * graphW + x) * 4;
          imgData.data[idx] = r;
          imgData.data[idx + 1] = g;
          imgData.data[idx + 2] = b;
          imgData.data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, axisW, 0);
    }

    // ---- 画音高标记线 (白键) ----
    ctx.font = "9px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const logMin = Math.log2(27.5);
    const logMax = Math.log2(maxFreq);
    const logRange = logMax - logMin;
    const minMidi = 33;
    const maxMidi = Math.min(127, Math.ceil(12 * Math.log2(maxFreq / 440) + 69));
    const whiteKeys = [0, 2, 4, 5, 7, 9, 11];
    const pitchColors = ["#ff4444","#ff6644","#ffaa00","#ffcc00","#aadd00","#44cc44","#00cc88","#00aaaa","#4488ff","#6666ff","#aa44ff","#cc44aa"];

    for (let midi = minMidi; midi <= maxMidi; midi++) {
      const nc = midi % 12;
      if (!whiteKeys.includes(nc)) continue;
      const freq = midiToFreq(midi);
      if (freq > maxFreq) break;
      const frac = Math.log2(freq / 27.5) / logRange;
      const y = graphH - frac * graphH;
      if (y < 0 || y > graphH) continue;
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(axisW, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      ctx.fillStyle = pitchColors[nc];
      const octave = Math.floor(midi / 12) - 1;
      ctx.fillText(NOTE_NAMES[nc] + octave, axisW - 4, y);
    }

    // ---- 画旋律音高轮廓线 ----
    if (pitch && pitch.length > 0) {
      ctx.strokeStyle = "rgba(0, 255, 170, 0.7)";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(0, 255, 170, 0.4)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      let started = false;
      const totalSec = duration || 30;
      for (let i = 0; i < pitch.length; i++) {
        if (pitch[i] <= 20) continue;
        const fracPitch = Math.log2(pitch[i] / 27.5) / logRange;
        const y = graphH - fracPitch * graphH;
        const px = axisW + (i / pitch.length) * graphW;
        if (!started) { ctx.moveTo(px, y); started = true; }
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(0, 255, 170, 0.5)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("🎵 旋律", axisW + 4, 14);
    }

    // ---- 如果有乐器音符标记，绘制 ----
    if (melodyNotes && melodyNotes.length > 0) {
      const totalSec = duration || 30;
      // 画音符方块
      melodyNotes.forEach((note, idx) => {
        if (note.midi <= 0) return;
        const freq = midiToFreq(note.midi);
        const fracPitch = Math.log2(freq / 27.5) / logRange;
        const y = graphH - fracPitch * graphH;
        const px = axisW + (note.time / totalSec) * graphW;
        ctx.fillStyle = "#ffcc00";
        ctx.beginPath();
        ctx.arc(px, y, 4, 0, Math.PI * 2);
        ctx.fill();
        // 每5个标一个名字
        if (idx % 5 === 0) {
          ctx.fillStyle = "rgba(255,204,0,0.6)";
          ctx.font = "8px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(note.name, px, y - 8);
        }
      });
    }

    // ---- 时间轴 ----
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#ffffff55";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const totalSec = duration || 30;
    const timeInterval = Math.max(1, Math.pow(10, Math.floor(Math.log10(totalSec / 6))));
    for (let t = 0; t <= totalSec; t += timeInterval) {
      const x = axisW + (t / totalSec) * graphW;
      ctx.fillText(t + "秒", x, graphH + 6);
    }

    // ---- 播放游标 ----
    if (currentTime !== undefined && duration && duration > 0) {
      const frac = currentTime / duration;
      const cx = axisW + frac * graphW;
      ctx.strokeStyle = "#00ffaa";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#00ffaa66";
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, graphH); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#00ffaa";
      ctx.beginPath(); ctx.moveTo(cx, 2); ctx.lineTo(cx + 5, 8); ctx.lineTo(cx, 14); ctx.lineTo(cx - 5, 8); ctx.closePath(); ctx.fill();
    }
  }, [data, frequencies, pitch, maxFreq, height, currentTime, duration, canvasWidth, melodyNotes]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data || !canvasRef.current) { setHoverInfo(null); return; }
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const axisW = 36;
    const graphW = canvasRef.current.width - axisW;
    const graphH = canvasRef.current.height - 24;
    const x = mx - axisW;
    if (x < 0 || x > graphW || my < 0 || my > graphH) { setHoverInfo(null); return; }
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

  if (!data && !melodyNotes) {
    return (
      <div style={{ height, background: "#0d1117", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
        加载中...
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      {label && (
        <div style={{ fontSize: 12, color: "#999", marginBottom: 2, fontWeight: 500 }}>{label}</div>
      )}
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={height}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
          style={{ width: "100%", height, borderRadius: 8, cursor: "crosshair", background: "#0d1117", display: "block" }}
        />
        {hoverInfo && (
          <div style={{ position: "absolute", bottom: 6, right: 8, fontSize: 11, color: "rgba(255,255,255,0.85)", background: "rgba(0,0,0,0.75)", padding: "4px 10px", borderRadius: 6, whiteSpace: "nowrap", backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <span style={{ color: "#00ffaa", fontWeight: "bold" }}>{hoverInfo.note}</span>
            {" | "}{hoverInfo.freq >= 1000 ? (hoverInfo.freq / 1000).toFixed(1) + " 千赫" : hoverInfo.freq + " 赫兹"}
            {" | "}{Math.floor(hoverInfo.time / 60)}:{String(Math.floor(hoverInfo.time % 60)).padStart(2, "0")}
          </div>
        )}
      </div>
    </div>
  );
};

export default SpectrogramViewer;
