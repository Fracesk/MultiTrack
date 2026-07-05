import React, { useRef, useEffect, useState, useCallback } from 'react';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// MIDI note number to frequency
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
  /** Current playback position in seconds */
  currentTime?: number;
  /** Total duration in seconds */
  duration?: number;
}

const SpectrogramViewer: React.FC<SpectrogramViewerProps> = ({
  data, frequencies, pitch, chroma, noteNames,
  height = 260, maxFreq = 8000, label = 'Spectrogram',
  currentTime, duration,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverInfo, setHoverInfo] = useState<{ freq: number; time: number; note: string } | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);

  // Resize observer
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
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Layout: left axis (40px) + graph (rest)
    const axisW = 44;
    const graphW = canvas.width - axisW;
    const graphH = canvas.height - 24; // bottom margin for labels

    // Clear
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const nFreq = data.length;
    const nTime = data[0]?.length || 1;

    // ---- Draw the main spectrogram ----
    // We want frequency to be logarithmic (like a musical scale)
    // Map pixel y to frequency: y=0 -> maxFreq, y=graphH -> 0

    // Pre-compute freq-to-y mapping for log scale
    const logMin = Math.log2(Math.max(27.5, 1)); // A0
    const logMax = Math.log2(maxFreq);
    const logRange = logMax - logMin;

    const imgData = ctx.createImageData(graphW, graphH);
    for (let x = 0; x < graphW; x++) {
      const tIdx = Math.floor((x / graphW) * nTime);
      for (let y = 0; y < graphH; y++) {
        // y=0 is top of graph = maxFreq
        // y=graphH is bottom = 27.5Hz (A0)
        const frac = 1 - y / graphH; // 0 at bottom, 1 at top
        const freqLog = Math.pow(2, logMin + frac * logRange);

        // Find closest frequency bin
        let fIdx = 0;
        for (let i = 0; i < frequencies.length; i++) {
          if (frequencies[i] <= freqLog) fIdx = i;
          else break;
        }
        fIdx = Math.min(fIdx, nFreq - 1);

        const val = data[fIdx]?.[tIdx] ?? -80;
        const norm = Math.max(0, Math.min(1, (val + 80) / 80));

        // Colormap
        let r, g, b;
        if (norm < 0.2) {
          r = 0; g = 0; b = Math.floor(norm * 5 * 255);
        } else if (norm < 0.4) {
          const t = (norm - 0.2) * 5;
          r = 0; g = Math.floor(t * 180); b = 255;
        } else if (norm < 0.6) {
          const t = (norm - 0.4) * 5;
          r = Math.floor(t * 255); g = 200 + Math.floor(t * 55); b = Math.floor((1 - t) * 255);
        } else if (norm < 0.8) {
          const t = (norm - 0.6) * 5;
          r = 255; g = Math.floor((1 - t) * 200); b = 0;
        } else {
          r = 255; g = 0; b = 0;
        }

        const idx = (y * graphW + x) * 4;
        imgData.data[idx] = r;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = b;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, axisW, 0);

    // ---- Draw 12-tone scale labels on left axis ----
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const PITCH_CLASS_COLORS = [
      '#ff4444', '#ff6644', '#ffaa00', '#ffcc00',
      '#aadd00', '#44cc44', '#00cc88', '#00aaaa',
      '#4488ff', '#6666ff', '#aa44ff', '#cc44aa'
    ];

    // Draw every note from A1 (MIDI 33) up to maxFreq
    const minMidi = 33; // A1 = 55Hz
    const maxMidi = Math.min(127, Math.ceil(12 * Math.log2(maxFreq / 440) + 69));
    const whiteKeyNotes = [0, 2, 4, 5, 7, 9, 11]; // C, D, E, F, G, A, B

    for (let midi = minMidi; midi <= maxMidi; midi++) {
      const freq = midiToFreq(midi);
      if (freq > maxFreq) break;

      const frac = Math.log2(freq / 27.5) / logRange;
      const y = graphH - frac * graphH + 0.5;

      if (y < 0 || y > graphH) continue;

      const noteClass = midi % 12;
      const octave = Math.floor(midi / 12) - 1;
      const isWhiteKey = whiteKeyNotes.includes(noteClass);

      // Only show all labels on white keys to avoid clutter
      // (black keys get tick marks)
      if (isWhiteKey) {
        ctx.fillStyle = '#ffffffcc';
        const label = NOTE_NAMES[noteClass];
        ctx.fillText(label.padStart(4, ' '), axisW - 4, y);
      }

      // Tick mark for every note
      ctx.strokeStyle = isWhiteKey ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(axisW - (isWhiteKey ? 12 : 6), y);
      ctx.lineTo(axisW, y);
      ctx.stroke();

      // Horizontal grid line
      ctx.strokeStyle = isWhiteKey ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.02)';
      ctx.beginPath();
      ctx.moveTo(axisW, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();

      // Note class indicator strip on the far left
      ctx.fillStyle = PITCH_CLASS_COLORS[noteClass] + '44';
      ctx.fillRect(0, Math.round(y) - 3, 4, 6);
    }

    // ---- Draw pitch contour (white thick line) ----
    if (pitch && pitch.length > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      let started = false;
      for (let x = 0; x < graphW; x++) {
        const tIdx = Math.floor((x / graphW) * pitch.length);
        if (tIdx >= pitch.length) continue;
        const freq = pitch[tIdx];
        if (!freq || freq <= 0 || freq > maxFreq) { started = false; continue; }
        const frac = Math.log2(freq / 27.5) / logRange;
        const y = graphH - frac * graphH + 0.5;
        if (y < 0 || y > graphH) { started = false; continue; }
        const px = axisW + x;
        if (!started) { ctx.moveTo(px, y); started = true; }
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ---- Draw time labels ----
    ctx.font = '10px monospace';
    ctx.fillStyle = '#ffffff66';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const totalSec = (duration || 30);
    const timeInterval = Math.max(1, Math.pow(10, Math.floor(Math.log10(totalSec / 6))));
    for (let t = 0; t <= totalSec; t += timeInterval) {
      const x = axisW + (t / totalSec) * graphW;
      ctx.fillText(t + 's', x, graphH + 4);
    }

    // ---- Draw moving playback cursor ----
    if (currentTime !== undefined && duration && duration > 0) {
      const frac = currentTime / duration;
      const cx = axisW + frac * graphW;
      ctx.strokeStyle = '#00ffaa';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00ffaa66';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, graphH);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Cursor top indicator
      ctx.fillStyle = '#00ffaa';
      ctx.beginPath();
      ctx.arc(cx, 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- Right panel: pitch confidence / chroma summary ----
    if (chroma && chroma.length === 12) {
      const rw = 14;
      const rx = canvas.width - rw - 2;
      const noteHeight = graphH / 12;

      for (let n = 0; n < 12; n++) {
        const ny = n * noteHeight;
        // Average chroma across all time
        const avgVal = Math.min(1, chroma[n].reduce((a, b) => a + b, 0) / chroma[n].length * 2);
        ctx.fillStyle = PITCH_CLASS_COLORS[n] + Math.floor(avgVal * 200).toString(16).padStart(2, '0');
        ctx.fillRect(rx, ny, rw, noteHeight - 1);

        ctx.fillStyle = '#ffffff44';
        ctx.font = '6px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(NOTE_NAMES[n], rx + rw / 2, ny + noteHeight / 2);
      }
    }
  }, [data, frequencies, pitch, chroma, maxFreq, height, currentTime, duration, canvasWidth]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const axisW = 44;
    const graphW = canvasRef.current.width - axisW;
    const graphH = canvasRef.current.height - 24;

    const x = mx - axisW;
    if (x < 0 || x > graphW || my < 0 || my > graphH) {
      setHoverInfo(null);
      return;
    }

    const nTime = data[0]?.length || 1;
    const tIdx = Math.floor((x / graphW) * nTime);

    // Frequency from log mapping
    const logMin = Math.log2(27.5);
    const logMax = Math.log2(maxFreq);
    const logRange = logMax - logMin;
    const frac = 1 - my / graphH;
    const freqLog = Math.pow(2, logMin + frac * logRange);

    // Find closest note
    const midi = 12 * Math.log2(freqLog / 440) + 69;
    const noteClass = Math.round(midi) % 12;
    const octave = Math.floor(Math.round(midi) / 12) - 1;
    const noteName = NOTE_NAMES[noteClass] + octave;

    const totalSec = (duration || 30);
    const timeSec = (tIdx / nTime) * totalSec;

    setHoverInfo({ freq: Math.round(freqLog), time: timeSec, note: noteName });
  }, [data, frequencies, maxFreq, duration]);

  if (!data) {
    return (
      <div style={{
        height, background: '#0a0a1a', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#666', fontSize: 13,
      }}>
        Loading spectrogram...
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {label && (
        <div style={{ fontSize: 11, color: '#999', marginBottom: 2, fontWeight: 500 }}>
          {label}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={height}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
          style={{
            width: '100%', height,
            borderRadius: 6, cursor: 'crosshair',
            background: '#0a0a1a', display: 'block',
          }}
        />
        {hoverInfo && (
          <div style={{
            position: 'absolute', bottom: 4, right: 8,
            fontSize: 11, color: 'rgba(255,255,255,0.8)',
            background: 'rgba(0,0,0,0.7)', padding: '3px 8px',
            borderRadius: 4, whiteSpace: 'nowrap',
          }}>
            {hoverInfo.note} | {hoverInfo.freq >= 1000
              ? (hoverInfo.freq / 1000).toFixed(1) + 'kHz'
              : hoverInfo.freq + 'Hz'}
            {' | '}{hoverInfo.time.toFixed(1)}s
          </div>
        )}
      </div>
    </div>
  );
};

export default SpectrogramViewer;

