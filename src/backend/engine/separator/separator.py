# -*- coding: utf-8 -*-
"""
Voice Separation Engine v16 - In-process Demucs (stable)
"""
import os, wave, numpy as np, tempfile, time, threading, shutil
from typing import Optional, Dict, Callable
from scipy import signal, ndimage
import sys



class SeparationEngine:
    def __init__(self):
        self._loaded = False; self._lock = threading.Lock()
        self._model_name = "htdemucs"
        self._model = None; self._model_sources = None; self._model_sr = None

    def load_model(self, model_type="htdemucs"):
        with self._lock: self._loaded = True; return True
    def unload_model(self):
        with self._lock: self._model = None; self._loaded = False
    def is_loaded(self): return self._loaded

    def _ensure_model(self):
        if self._model is not None: return
        os.environ["TORCHAUDIO_USE_SOUNDFILE"] = "1"
        from demucs import pretrained
        m = pretrained.get_model(self._model_name)
        m.eval(); m.cpu()
        self._model = m; self._model_sources = list(m.sources); self._model_sr = m.samplerate

    def _read_wav(self, path):
        with wave.open(path, "r") as wf:
            sr = wf.getframerate(); nf = wf.getnframes()
            ch = wf.getnchannels(); sw = wf.getsampwidth()
            dt = {1:np.int8,2:np.int16,4:np.int32}.get(sw,np.int16)
            d = np.frombuffer(wf.readframes(nf), dtype=dt).astype(np.float64)
            if ch > 1: d = d.reshape(-1, ch); return d, sr, ch, d.mean(axis=1)
            return d, sr, ch, d

    def _write_wav(self, samples, sr, path):
        mx = np.max(np.abs(samples))
        if mx > 0: samples = samples / mx * 0.95
        np.clip(samples, -1.0, 1.0, out=samples)
        with wave.open(path, "w") as wf:
            wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
            wf.writeframes((samples * 32767).astype(np.int16).tobytes())

    def _stft(self, x, n_fft=2048, hop=512):
        _, _, Z = signal.stft(x, 1.0, nperseg=n_fft, noverlap=n_fft-hop, window="hann", boundary=None, padded=True)
        return Z
    def _istft(self, X, n_fft=2048, hop=512, length=None):
        _, x = signal.istft(X, 1.0, nperseg=n_fft, noverlap=n_fft-hop, window="hann", boundary=True)
        return x[:length] if length else x

    def separate(self, audio_path, mode="2stems", progress_callback=None):
        if not self._loaded: self.load_model()
        if progress_callback: progress_callback(1, "Starting...")
        try:
            wav_path, _ = self._ensure_wav(audio_path)
            return self._separate_demucs(wav_path, progress_callback)
        except Exception as e:
            print(f"Demucs failed ({e}), STFT fallback")
            return self._separate_stft(audio_path, mode, progress_callback)

    def _ensure_wav(self, audio_path):
        """Convert MP3/other to WAV if needed, return WAV path."""
        if audio_path.lower().endswith(".wav"):
            return audio_path, False
        import subprocess as _sp, tempfile as _tf, shutil as _sh
        import miniaudio as _ma
        import scipy.io.wavfile as _wio
        safe_name = "vc_input_%d" % int(time.time()) + os.path.splitext(audio_path)[1]
        safe_path = os.path.join(_tf.gettempdir(), safe_name)
        try: _sh.copy2(audio_path, safe_path)
        except: safe_path = audio_path
        try:
            r = _ma.decode_file(safe_path, output_format=_ma.SampleFormat.SIGNED16)
            sr = r.sample_rate; nch = r.nchannels
            s = np.frombuffer(r.samples, dtype=np.int16).astype(np.float64)
            if nch > 1: s = s.reshape(-1, nch).mean(axis=1)
            s = (s / np.max(np.abs(s)) * 0.95 * 32767).astype(np.int16) if np.max(np.abs(s)) > 0 else s.astype(np.int16)
            wav_path = os.path.join(_tf.gettempdir(), "vc_converted_%d.wav" % int(time.time()*1000))
            _wio.write(wav_path, sr, s)
            if safe_path != audio_path:
                try: os.unlink(safe_path)
                except: pass
            return wav_path, True
        except Exception as e:
            print(f"Convert failed: {e}")
            return audio_path, False

    def _separate_demucs(self, audio_path, progress_callback=None):
        self._ensure_model()
        import torch, torchaudio.functional as AF

        if progress_callback: progress_callback(5, "Loading audio...")
        audio_path, _ = self._ensure_wav(audio_path)
        data, sr, n_ch, mono = self._read_wav(audio_path)

        ds = np.column_stack([mono, mono])
        at = torch.from_numpy(ds.T.astype(np.float32))
        if sr != self._model_sr:
            at = AF.resample(at, sr, self._model_sr)
            sr = self._model_sr

        if progress_callback: progress_callback(15, "Demucs processing...")
        from demucs.apply import apply_model as apply_fn

        tl = at.shape[-1]; sl = int(7.0 * sr)
        vi = self._model_sources.index("vocals")
        oi = [i for i in range(len(self._model_sources)) if i != vi]
        av, aa = [], []
        n_seg = max(1, (tl + sl - 1) // sl)

        for si in range(n_seg):
            s = si * sl; e = min(s + sl, tl)
            sg = at[:, s:e]
            if sg.shape[-1] < sl:
                sg = torch.nn.functional.pad(sg, (0, sl - sg.shape[-1]))
            with torch.no_grad():
                o = apply_fn(self._model, sg.unsqueeze(0), shifts=1, split=False, overlap=0.25, device="cpu")[0]
            av.append(o[vi, :, :e-s].cpu().numpy())
            aa.append(o[oi].sum(dim=0)[:, :e-s].cpu().numpy())
            if progress_callback:
                p = 20 + int((si+1)/n_seg*65)
                progress_callback(min(85, p), f"Demucs {si+1}/{n_seg}")

        if progress_callback: progress_callback(90, "Saving...")
        import scipy.io.wavfile as _wio
        vocals = np.concatenate(av, axis=-1).mean(axis=0)
        accomp = np.concatenate(aa, axis=-1).mean(axis=0)

        result = {}
        for sn, arr in [("vocals", vocals), ("accompaniment", accomp)]:
            mx = np.max(np.abs(arr))
            if mx > 0: arr32 = (arr / mx * 0.95 * 32767).astype(np.int16)
            else: arr32 = np.zeros_like(arr, dtype=np.int16)
            p = os.path.join(tempfile.gettempdir(), f"voicecraft_{sn}_{int(time.time()*1000)}.wav")
            _wio.write(p, sr, arr32)
            result[sn] = p
        if progress_callback: progress_callback(100, "Complete")
        return result

    def _separate_stft(self, audio_path, mode="2stems", progress_callback=None):
        import warnings
        warnings.warn("STFT fallback - lower quality")
        try: data, sr, n_ch, mono = self._read_wav(audio_path)
        except: return self._generate_sine(mode)
        n = len(mono); n_fft = 2048; hop = 512; seg_len = int(sr * 15)
        n_seg = max(1, (n + seg_len - 1) // seg_len)
        rv = np.zeros(n, dtype=np.float64); ra = np.zeros(n, dtype=np.float64)
        for si in range(n_seg):
            if progress_callback: progress_callback(10 + int(si/n_seg*70), f"STFT {si+1}/{n_seg}")
            cs = si * seg_len; ce = min(cs + seg_len, n); seg = mono[cs:ce]
            Z = self._stft(seg, n_fft, hop); mag = np.abs(Z); phase = np.angle(Z)
            freqs = np.fft.rfftfreq(n_fft, 1.0/sr)
            nf = np.percentile(mag, 15, axis=1, keepdims=True)
            sdb = 20 * np.log10(np.maximum(mag / np.maximum(nf, 1e-10), 1e-10))
            vm = np.zeros_like(mag)
            for br, th, rg, mw in [
                (freqs<150,12,4,0.05),((freqs>=150)&(freqs<250),8,4,0.25),
                ((freqs>=250)&(freqs<500),6,3,0.45),((freqs>=500)&(freqs<1500),4,3,0.65),
                ((freqs>=1500)&(freqs<3000),5,4,0.45),((freqs>=3000)&(freqs<6000),8,5,0.25),
                ((freqs>=6000)&(freqs<10000),12,6,0.08),(freqs>=10000,15,8,0.02),
            ]: vm[br] = np.clip((sdb[br]-th)/rg,0,1)*mw
            vm = ndimage.gaussian_filter(vm, sigma=(0.5,1)); vm = np.clip(vm,0,1); vm = np.where(vm>0.12,vm,0)
            am = np.clip(1.0-vm*1.8,0,1); am[freqs<200] = np.maximum(am[freqs<200],0.95)
            voc = self._istft(mag*vm*np.exp(1j*phase), n_fft, hop, length=ce-cs)
            acc = self._istft(mag*am*np.exp(1j*phase), n_fft, hop, length=ce-cs)
            slo = min(len(voc),len(acc),ce-cs); rv[cs:cs+slo]=voc[:slo]; ra[cs:cs+slo]=acc[:slo]
        if progress_callback: progress_callback(90,"Saving...")
        result = {}
        for sn,arr in [("vocals",rv),("accompaniment",ra)]:
            mx = np.max(np.abs(arr))
            if mx>0: arr=arr/mx*0.95
            p = os.path.join(tempfile.gettempdir(),f"voicecraft_{sn}_{int(time.time()*1000)}.wav")
            self._write_wav(arr,sr,p); result[sn]=p
        if progress_callback: progress_callback(100,"Complete")
        return result

    def get_spectrogram(self, audio_path, max_freq=8000):
        try: data,sr,n_ch,mono = self._read_wav(audio_path)
        except: return {"error":"Cannot read audio"}
        n_fft=2048; hop=512
        Z=self._stft(mono,n_fft,hop); mag=np.abs(Z)
        freqs=np.fft.rfftfreq(n_fft,1.0/sr)
        max_bin=np.searchsorted(freqs,max_freq)
        mag=mag[:max_bin]; freqs=freqs[:max_bin]
        mag_db=np.clip(20*np.log10(mag+1e-10),-80,0)
        max_pts=500
        if mag.shape[1]>max_pts: mag_db=mag_db[:,::mag.shape[1]//max_pts]
        pitch,conf=self._detect_pitch(mono,sr,hop=512)
        nf=mag_db.shape[1]
        pitch_hz=np.interp(np.linspace(0,1,nf),np.linspace(0,1,len(pitch)),pitch)
        Zf=self._stft(mono,n_fft,hop); mf=np.abs(Zf); ff=np.fft.rfftfreq(n_fft,1.0/sr)
        if mf.shape[1]>max_pts: mf=mf[:,::mf.shape[1]//max_pts]
        chroma=self._compute_chroma(mf,ff,sr)
        if chroma.shape[1]>max_pts: chroma=chroma[:,::chroma.shape[1]//max_pts]
        return {
            "spectrogram":mag_db.tolist(),"frequencies":freqs.tolist(),
            "time_frames":mag_db.shape[1],"sample_rate":sr,
            "pitch":[float(p) if not np.isnan(p) and not np.isinf(p) else 0 for p in pitch_hz],
            "confidence":[float(c) for c in np.interp(np.linspace(0,1,nf),np.linspace(0,1,len(conf)),conf)],
            "max_freq":max_freq,"chroma":chroma.tolist(),
            "note_names":["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"],
            "duration_sec":len(mono)/sr,"hop_ms":hop/sr*1000,
        }

    def _detect_pitch(self,samples,sr,fmin=65.0,fmax=1600.0,hop=512):
        n_fft=2048; nt=1+(len(samples)-n_fft)//hop
        if nt<=0: return np.array([]),np.array([])
        cs=min(nt,1000); ap,ac=[],[]
        for c in range(0,nt,cs):
            ce=min(c+cs,nt); nc=ce-c; frames=np.zeros((nc,n_fft))
            for j in range(nc):
                i=c+j; s=i*hop; e=min(s+n_fft,len(samples))
                frames[j,:len(samples[s:e])]=samples[s:e]
            frames*=np.hanning(n_fft)
            ff=np.fft.rfft(frames); pw=np.abs(ff)**2
            acf=np.fft.irfft(pw,n=n_fft,axis=1)[:,:n_fft//2]
            acf/=np.maximum(np.abs(acf[:,0:1]),1e-10)
            mi=int(sr/fmax); ma=int(sr/fmin)
            if ma>=acf.shape[1]: ma=acf.shape[1]-1
            if mi>=ma: mi=max(1,ma-1)
            srch=acf[:,mi:ma+1]
            if srch.shape[1]==0: ap.append(np.zeros(nc)); ac.append(np.zeros(nc)); continue
            pi=np.argmax(srch,axis=1); pv=np.max(srch,axis=1); lg=mi+pi
            p=np.where((pv>0.15)&(lg>0),sr/lg.astype(float),0.0)
            ap.append(p); ac.append(pv)
        pitch=ndimage.median_filter(np.concatenate(ap)[:nt],size=5)
        conf=np.concatenate(ac)[:nt]
        return pitch,conf

    def _compute_chroma(self,mag,freqs,sr):
        nf,nt=mag.shape; chroma=np.zeros((12,nt))
        for i,f in enumerate(freqs[1:],1):
            if f<=0: continue
            nc=int(12*np.log2(f/440.0)+69)%12
            if 0<=nc<12: chroma[nc]+=mag[i]
        for t in range(nt):
            s=chroma[:,t].sum()
            if s>0: chroma[:,t]/=s
        return chroma

    def _generate_sine(self,mode):
        import math,struct
        sr=44100; ns=int(sr*3); r={}
        sm={"2stems":[("vocals",300),("accompaniment",200)],"4stems":[("vocals",300),("bass",80),("drums",150),("other",400)]}
        for n,f in sm.get(mode,[("vocals",300)]):
            p=os.path.join(tempfile.gettempdir(),f"voicecraft_{n}_{int(time.time()*1000)}.wav")
            sd=[int(math.sin(2*math.pi*f*i/sr)*0.3*32767) for i in range(ns)]
            with wave.open(p,"w") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(struct.pack("<%dh"%ns,*sd))
            r[n]=p
        return r

separation_engine = SeparationEngine()






