import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Radio, Progress, Space, message, Tag, Typography, Tabs, Slider, Tooltip } from 'antd';
import {
  NodeIndexOutlined, PlayCircleOutlined, PauseCircleOutlined,
  LeftOutlined, RightOutlined, BarChartOutlined, DownloadOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { useAppStore, StemTrack } from '../stores/appStore';
import { separateAudio, getAudioUrl, getSpectrogramByPath, SpectrogramData } from '../utils/api';
import { useAudioPlayer } from '../utils/useAudioPlayer';
import SpectrogramViewer from '../components/SpectrogramViewer';

const { Text } = Typography;

const STEM_NAMES: Record<string, string> = {
  vocals: 'Vocal', accompaniment: 'Accompaniment', bass: 'Bass',
  drums: 'Drums', other: 'Other', piano: 'Piano', guitar: 'Guitar',
};
const STEM_ICONS: Record<string, string> = {
  vocals: '\ud83c\udfa4', accompaniment: '\ud83c\udfb5', bass: '\ud83e\ude95', drums: '\ud83e\udd41',
  other: '\ud83c\udfb6', piano: '\ud83c\udfb9', guitar: '\ud83c\udfb8',
};

const StepSeparate: React.FC<{ onNext: () => void; onPrev: () => void }> = ({ onNext, onPrev }) => {
  const { audioFile, stems, setStems, setProcessing, processing,
    processingProgress, processingStatus, setProcessingProgress } = useAppStore();
  const { isPlaying, currentTime, duration, play, pause, stop } = useAudioPlayer();
  const [mode, setMode] = useState('2stems');
  const [separated, setSeparated] = useState(false);
  const [activeStem, setActiveStem] = useState<string | null>(null);

  // Spectrogram data
  const [specMap, setSpecMap] = useState<Record<string, SpectrogramData | null>>({});
  const [activeSpec, setActiveSpec] = useState<string>('original');

  // Get original spectrogram
  useEffect(() => {
    if (audioFile?.fileObj && !specMap['original'] && !separated) {
      (async () => {
        try {
          const form = new FormData();
          form.append('file', audioFile.fileObj!);
          form.append('max_freq', '8000');
          const api = (await import('../utils/api')).default;
          const res = await api.post('/api/spectrogram', form);
          setSpecMap((prev) => ({ ...prev, original: { ...res.data, duration_sec: res.data.duration_sec || 30 } }));
        } catch {}
      })();
    }
  }, [audioFile]);

  const handleSeparate = async () => {
    if (!audioFile || !audioFile.fileObj) {
      message.error('Please import an audio file first');
      return;
    }

    const progressTimer = setInterval(() => {
      const cur = useAppStore.getState().processingProgress;
      if (cur >= 90) return;
      const increment = cur < 50 ? 3 : (cur < 70 ? 1 : 0.5);
      setProcessingProgress(Math.min(90, cur + increment), useAppStore.getState().processingStatus);
    }, 3000);
    const cleanup = () => clearInterval(progressTimer);

    try {
      setProcessing(true);
      setProcessingProgress(5, 'Uploading and separating...');

      const result = await separateAudio(audioFile.fileObj, mode);

      if (result.status !== 'success') {
        cleanup();
        message.error('Separation failed');
        setProcessing(false);
        return;
      }

      const stemTypes = mode === '2stems'
        ? ['vocals', 'accompaniment']
        : ['vocals', 'accompaniment', 'bass', 'drums'];

      const stemList: StemTrack[] = [];
      stemTypes.forEach((type) => {
        const sd = result.stems[type];
        if (sd) {
          stemList.push({
            id: type, name: STEM_NAMES[type] || type,
            type: type as any, filePath: sd.path,
            downloadUrl: getAudioUrl(sd.path),
            duration: result.audio_info?.duration || 30,
            active: true, volume: 100, pan: 0,
          });
        }
      });

      if (stemList.length === 0) {
        cleanup();
        message.error('No stems returned');
        setProcessing(false);
        return;
      }

      cleanup();
      setStems(stemList);
      setSeparated(true);
      setProcessing(false);
      setProcessingProgress(100, 'Done');
      message.success('Separation complete! ' + stemList.length + ' stems');

      // Load spectrograms for each stem
      for (const stem of stemList) {
        getSpectrogramByPath(stem.filePath, 8000).then((spec) => {
          setSpecMap((prev) => ({ ...prev, [stem.id]: spec }));
        }).catch(() => {});
      }
      cleanup();
    } catch (e: any) {
      cleanup();
      console.error('Separation error:', e);
      message.error('Separation failed: ' + (e.message || 'Backend unavailable'));
      setProcessing(false);
    }
  };

  const togglePlay = (stem: StemTrack) => {
    if (isPlaying && activeStem === stem.id) {
      pause();
      setActiveStem(null);
      return;
    }
    stop();
    if (stem.downloadUrl) {
      play(stem.downloadUrl);
      setActiveStem(stem.id);
    }
  };

  const handleExport = (stemPath: string, stemName: string) => {
    // Trigger download via a temp anchor
    const a = document.createElement('a');
    a.href = getAudioUrl(stemPath);
    a.download = stemName + '.wav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const currentSpec: SpectrogramData | null = activeSpec === 'original'
    ? specMap['original'] || null
    : specMap[activeSpec] || null;

  return (
    <div className='step-card active' style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div className='step-header'>
        <div className='step-number active'>2</div>
        <span className='step-title'>AI Audio Separation</span>
        {separated && <Tag color='success'>Complete</Tag>}
      </div>

      <div className='step-content'>
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8 }}>Separation Mode</Text>
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}
            disabled={processing || separated} optionType='button' buttonStyle='solid'>
            <Radio.Button value='2stems'>2-Stem (Vocals + Accompaniment)</Radio.Button>
            <Radio.Button value='4stems'>4-Stem (Vocals + Bass + Drums + Other)</Radio.Button>
          </Radio.Group>
        </div>

        {processing && (
          <div className='progress-container'>
            <div className='progress-info'>
              <span>{processingStatus}</span>
              <span>{processingProgress}%</span>
            </div>
            <Progress percent={processingProgress} status='active' strokeColor='#1F4788' />
          </div>
        )}

        {!processing && !separated && (
          <Button type='primary' size='large' icon={<NodeIndexOutlined />}
            onClick={handleSeparate} disabled={!audioFile?.fileObj}
            style={{ marginBottom: 16 }}>
            {audioFile?.fileObj ? 'Start Separation' : 'Import Audio First'}
          </Button>
        )}

        {separated && (
          <div>
            {/* Stem spectrogram viewer with real-time cursor */}
            {currentSpec && (
              <div style={{ marginBottom: 16 }}>
                <Tabs
                  activeKey={activeSpec}
                  onChange={setActiveSpec}
                  size='small'
                  style={{ marginBottom: 4 }}
                  items={[
                    { key: 'original', label: 'Original' },
                    ...stems.map((s) => ({
                      key: s.id, label: (STEM_ICONS[s.type] || '') + ' ' + s.name,
                    })),
                  ]}
                />
                <SpectrogramViewer
                  data={currentSpec.spectrogram}
                  frequencies={currentSpec.frequencies}
                  pitch={currentSpec.pitch}
                  chroma={currentSpec.chroma}
                  noteNames={currentSpec.note_names}
                  label={activeSpec === 'original' ? 'Original Audio' : (stems.find((s) => s.id === activeSpec)?.name || '') + ' Spectrogram'}
                  height={280}
                  maxFreq={8000}
                  currentTime={activeStem === activeSpec ? currentTime : undefined}
                  duration={duration || currentSpec.duration_sec || 30}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: '#666' }}>
                    Left: 12-tone scale | Center: Spectrogram + pitch contour (white line) | Right: Chromagram
                  </span>
                  {isPlaying && activeStem === activeSpec && (
                    <span style={{ fontSize: 10, color: '#00ffaa' }}>
                      {(currentTime || 0).toFixed(1)}s / {(duration || 0).toFixed(1)}s
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Stem list with playback and export */}
            <div className='stem-list'>
              {stems.map((stem) => (
                <div
                  key={stem.id}
                  className={'stem-item ' + (activeStem === stem.id ? 'active' : '')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                    <span className='stem-icon'>{STEM_ICONS[stem.type] || '\ud83c\udfb5'}</span>
                    <div className='stem-name'>{stem.name}</div>
                    <div>
                      {isPlaying && activeStem === stem.id ? (
                        <PauseCircleOutlined onClick={() => { pause(); setActiveStem(null); }}
                          style={{ color: '#1F4788', fontSize: 20, cursor: 'pointer' }} />
                      ) : (
                        <PlayCircleOutlined onClick={() => togglePlay(stem)}
                          style={{ color: '#666', fontSize: 20, cursor: 'pointer' }} />
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tooltip title='View spectrogram'>
                      <BarChartOutlined
                        style={{ cursor: 'pointer', color: activeSpec === stem.id ? '#1F4788' : '#999' }}
                        onClick={() => setActiveSpec(stem.id)}
                      />
                    </Tooltip>
                    <Tooltip title='Download'>
                      <DownloadOutlined
                        style={{ cursor: 'pointer', color: '#999' }}
                        onClick={() => handleExport(stem.filePath, stem.name)}
                      />
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
              <Space>
                <Button onClick={onPrev} icon={<LeftOutlined />}>Back</Button>
                <Button type='primary' size='large' onClick={onNext} icon={<RightOutlined />}>
                  Voice Conversion
                </Button>
              </Space>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StepSeparate;


