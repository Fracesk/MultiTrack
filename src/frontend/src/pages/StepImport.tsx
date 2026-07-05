import React, { useRef, useState } from 'react';
import { Button, message, Typography, Space, Tag } from 'antd';
import { UploadOutlined, FileAddOutlined, InboxOutlined, RightOutlined } from '@ant-design/icons';
import { useAppStore, AudioFile } from '../stores/appStore';
import { uploadAudio } from '../utils/api';

const { Text } = Typography;
const SUPPORTED_FORMATS = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'];

const StepImport: React.FC<{ onNext: () => void }> = ({ onNext }) => {
  const { audioFile, setAudioFile } = useAppStore();
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadedPath, setUploadedPath] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !SUPPORTED_FORMATS.includes(ext)) {
      message.error(`不支持的文件格式: .${ext}`);
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      message.error('文件过大，最大 200MB');
      return;
    }

    setLoading(true);
    message.loading({ content: '正在分析音频...', key: 'import' });

    // 读取音频时长
    let duration = 0;
    try {
      const url = URL.createObjectURL(file);
      const audioElement = new Audio(url);
      await new Promise<void>((resolve) => {
        audioElement.onloadedmetadata = () => { duration = Math.round(audioElement.duration); URL.revokeObjectURL(url); resolve(); };
        audioElement.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      });
    } catch {}

    // 使用 Web Audio API 将音频解码并转为 WAV 格式（PCM 16-bit mono）
    let uploadFile = file; // 默认使用原文件
    let decodedWav: Blob | null = null;

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      // 转为 WAV (PCM 16-bit mono, 44100Hz)
      const numChannels = 1;
      const sampleRate = 44100;
      const numFrames = audioBuffer.duration * sampleRate;
      const pcmData = new Float32Array(numFrames);

      // Mix down to mono
      const originalData = audioBuffer.getChannelData(0);
      for (let i = 0; i < numFrames; i++) {
        const srcIdx = Math.floor((i / numFrames) * originalData.length);
        pcmData[i] = originalData[Math.min(srcIdx, originalData.length - 1)];
      }

      // Encode WAV
      const numSamples = pcmData.length;
      const wavBuffer = new ArrayBuffer(44 + numSamples * 2);
      const view = new DataView(wavBuffer);

      function writeString(offset: number, str: string) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
      }
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + numSamples * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numChannels * 2, true);
      view.setUint16(32, numChannels * 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, numSamples * 2, true);

      for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, pcmData[i]));
        view.setInt16(44 + i * 2, s * 0x7FFF, true);
      }

      decodedWav = new Blob([wavBuffer], { type: 'audio/wav' });
      // 用 WAV 文件替换原始文件（保留原始文件名但扩展名改为 .wav）
      const wavName = file.name.replace(/\.[^.]+$/, '') + '.wav';
      uploadFile = new File([decodedWav], wavName, { type: 'audio/wav' });
    } catch (e) {
      console.warn("AudioContext decode failed, uploading raw file:", e);
    }

    const audioFileData: AudioFile = {
      name: file.name,
      path: file.name,
      size: uploadFile.size,
      duration,
      sampleRate: 44100,
      channels: 1,
      format: 'wav',
      fileObj: uploadFile,
    };

    // 上传到后端
    try {
      const result = await uploadAudio(uploadFile);
      if (result.status === 'success') {
        audioFileData.uploadedPath = result.path;
        setUploadedPath(result.path);
        setUploaded(true);
        message.success({ content: `已上传并解码: ${file.name}`, key: 'import' });
      }
    } catch (e: any) {
      message.warning({ content: '后端未连接，使用本地模式', key: 'import', duration: 3 });
    }

    setAudioFile(audioFileData);
    setLoading(false);
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);

  const handleClick = () => inputRef.current?.click();
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const formatDuration = (s: number) => s > 0 ? `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}` : '--:--';

  return (
    <div className="step-card" style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <div className="step-header">
        <div className="step-number active">1</div>
        <span className="step-title">导入音频</span>
        {audioFile && <Tag color="success">已导入</Tag>}
        {uploaded && <Tag color="blue">已上传至服务器</Tag>}
      </div>
      <div className="step-content">
        {!audioFile ? (
          <>
            <div className={`drop-zone ${dragging ? 'dragover' : ''}`}
              onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onClick={handleClick}>
              <div className="drop-zone-icon"><InboxOutlined /></div>
              <div className="drop-zone-text">点击或拖拽 MP3/WAV 文件到此处</div>
              <div className="drop-zone-hint">支持 MP3, WAV, FLAC, AAC, OGG, M4A（自动转为 WAV 格式处理）</div>
            </div>
            <input ref={inputRef} type="file" accept=".mp3,.wav,.flac,.aac,.ogg,.m4a" style={{ display: 'none' }} onChange={handleInputChange} />
          </>
        ) : (
          <div style={{ padding: '24px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <FileAddOutlined style={{ fontSize: 40, color: '#1F4788' }} />
              <div>
                <Text strong style={{ fontSize: 16 }}>{audioFile.name}</Text>
                <div style={{ marginTop: 4 }}>
                  <Space size={16}>
                    <Text type="secondary">{formatSize(audioFile.size)}</Text>
                    <Text type="secondary">{audioFile.sampleRate / 1000}kHz</Text>
                    <Text type="secondary">{audioFile.channels === 1 ? '单声道' : '立体声'}</Text>
                    <Text type="secondary">{formatDuration(audioFile.duration)}</Text>
                  </Space>
                </div>
                {uploaded && <Text type="success" style={{ fontSize: 12 }}>✓ 已上传至后端处理服务器</Text>}
              </div>
            </div>
            <Space>
              <Button type="primary" size="large" icon={<RightOutlined />} onClick={onNext}>开始分离</Button>
              <Button onClick={() => setAudioFile(null)}>重新选择</Button>
            </Space>
          </div>
        )}
      </div>
    </div>
  );
};

export default StepImport;
