import React, { useState, useRef, useEffect } from "react";
import { Button, Slider, Card, Row, Col, Space, Tag, Typography, Input, message, Progress, Radio } from "antd";
import {
  SoundOutlined, LeftOutlined, RightOutlined, CheckOutlined,
  SearchOutlined, PlayCircleOutlined, PauseCircleOutlined,
  StopOutlined, AudioOutlined, StepForwardOutlined,
} from "@ant-design/icons";
import { useAppStore, VoicePreset, StemTrack } from "../stores/appStore";
import { convertVoice, fetchVoices, getAudioUrl } from "../utils/api";
import { useAudioPlayer } from "../utils/useAudioPlayer";

const { Text, Title } = Typography;

const CATEGORIES = ["全部", "男声", "女声", "特效", "乐器模仿"];

const StepVoiceConvert: React.FC<{ onNext: () => void; onPrev: () => void }> = ({ onNext, onPrev }) => {
  const {
    audioFile, stems, selectedVoice, setSelectedVoice,
    voiceParams, setVoiceParams, setConvertedVocalsPath,
    processing, setProcessing,
  } = useAppStore();
  const { isPlaying, currentTime, duration, play, pause, stop } = useAudioPlayer();
  const [categoryFilter, setCategoryFilter] = useState("全部");
  const [searchText, setSearchText] = useState("");
  const [voiceList, setVoiceList] = useState<VoicePreset[]>([]);
  const [converting, setConverting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedSourceStem, setSelectedSourceStem] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const intervalRef = useRef<number | null>(null);

  // 可用来变声的音频源：原始音频 + 所有分离后的 stems
  const sourceOptions: { label: string; value: string; icon: string }[] = [];
  if (audioFile?.uploadedPath || audioFile?.path) {
    sourceOptions.push({
      label: audioFile?.name || "原始音频",
      value: audioFile?.uploadedPath || audioFile?.path || "",
      icon: "🎵",
    });
  }
  stems.forEach((s) => {
    sourceOptions.push({
      label: s.name,
      value: s.filePath,
      icon: s.type === "vocals" ? "🎤" : s.type === "accompaniment" ? "🎶" : "🎵",
    });
  });

  // 默认选中人声（如果有）
  useEffect(() => {
    if (!selectedSourceStem && sourceOptions.length > 0) {
      const vocals = sourceOptions.find((o) => o.label === "Vocal" || o.label === "vocals");
      if (vocals) setSelectedSourceStem(vocals.value);
      else setSelectedSourceStem(sourceOptions[0].value);
    }
  }, [stems, audioFile]);

  // Load voices from backend
  useEffect(() => {
    fetchVoices().then((data) => {
      const all: VoicePreset[] = [];
      (data.builtin || []).forEach((v: any) => {
        all.push({ id: v.id, name: v.name, category: v.category, isBuiltin: true });
      });
      (data.instrument || []).forEach((v: any) => {
        all.push({ id: v.id, name: v.name, category: v.category, isBuiltin: true });
      });
      setVoiceList(all);
    }).catch(() => {
      // Fallback
      setVoiceList([
        { id: "male-bass", name: "磁性男低音", category: "男声", isBuiltin: true },
        { id: "male-baritone", name: "温暖男中音", category: "男声", isBuiltin: true },
        { id: "male-tenor", name: "清亮男高音", category: "男声", isBuiltin: true },
        { id: "female-soprano", name: "明亮女高音", category: "女声", isBuiltin: true },
        { id: "female-mezzo", name: "醇厚女中音", category: "女声", isBuiltin: true },
        { id: "female-sweet", name: "甜美少女音", category: "女声", isBuiltin: true },
        { id: "child", name: "可爱童声", category: "特效", isBuiltin: true },
        { id: "anime-girl", name: "动漫少女", category: "特效", isBuiltin: true },
        { id: "anime-boy", name: "动漫少年", category: "特效", isBuiltin: true },
        { id: "robot", name: "电子合成音", category: "特效", isBuiltin: true },
        { id: "narrator", name: "影视旁白", category: "特效", isBuiltin: true },
        { id: "vintage", name: "复古电台", category: "特效", isBuiltin: true },
        // Instrument voices
        { id: "instrument-piano", name: "🎹 钢琴", category: "乐器模仿", isBuiltin: true },
        { id: "instrument-guitar", name: "🎸 吉他", category: "乐器模仿", isBuiltin: true },
        { id: "instrument-violin", name: "🎻 小提琴", category: "乐器模仿", isBuiltin: true },
        { id: "instrument-flute", name: "🎵 长笛", category: "乐器模仿", isBuiltin: true },
        { id: "instrument-trumpet", name: "🎺 小号", category: "乐器模仿", isBuiltin: true },
      ]);
    });
  }, []);

  const filteredVoices = voiceList.filter((v) => {
    if (categoryFilter !== "全部" && v.category !== categoryFilter) return false;
    if (searchText && !v.name.includes(searchText)) return false;
    return true;
  });

  const startProgressSim = () => {
    setProgress(0);
    setProgressMsg("正在准备...");
    if (intervalRef.current) clearInterval(intervalRef.current);
    let p = 0;
    intervalRef.current = window.setInterval(() => {
      p += Math.random() * 3;
      if (p < 30) setProgressMsg("正在分析音频特征...");
      else if (p < 60) setProgressMsg("正在应用音色滤镜...");
      else if (p < 85) setProgressMsg("正在合成音轨...");
      else setProgressMsg("即将完成...");
      setProgress(Math.min(95, p));
    }, 500);
  };

  const stopProgressSim = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setProgress(100);
    setProgressMsg("转换完成！");
    setTimeout(() => {
      setProgress(0);
      setProgressMsg("");
    }, 1500);
  };

  const handleConvert = async (voice: VoicePreset) => {
    setSelectedVoice(voice);
    if (!selectedSourceStem) {
      message.warning("请先选择一个音频源");
      return;
    }

    setConverting(true);
    startProgressSim();

    try {
      const result = await convertVoice(
        selectedSourceStem, voice.id,
        voiceParams.pitchShift, voiceParams.intensity
      );

      if (result.status === "success") {
        const url = getAudioUrl(result.path);
        setPreviewUrl(url);
        setConvertedVocalsPath(result.path);
        stopProgressSim();
        message.success({ content: "转换完成！点击试听按钮播放", key: "convert", duration: 3 });
      } else {
        stopProgressSim();
        message.error({ content: "转换失败", key: "convert" });
      }
    } catch (e: any) {
      stopProgressSim();
      console.error("Convert error:", e);
      message.warning({ content: "后端转换失败，请检查后端服务", key: "convert", duration: 3 });
    }

    setConverting(false);
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      pause();
      return;
    }
    if (previewUrl) {
      stop();
      play(previewUrl);
    }
  };

  // Playback progress bar
  const playbackPercent = duration && duration > 0 ? ((currentTime || 0) / duration) * 100 : 0;
  const playbackTimeStr = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="step-card active" style={{ maxWidth: 900, margin: "0 auto", width: "100%" }}>
      <div className="step-header">
        <div className="step-number active">3</div>
        <span className="step-title">🎛️ 变声与乐器模仿</span>
        {selectedVoice && <Tag color="blue">{selectedVoice.name}</Tag>}
        {previewUrl && <Tag color="green">✅ 已转换</Tag>}
      </div>

      <div className="step-content">
        {/* 选择音频源 - 新增 */}
        <div style={{ marginBottom: 20, padding: "12px 16px", background: "#f9f9ff", borderRadius: 8, border: "1px solid #e8e8f0" }}>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            <AudioOutlined /> 选择要变声的音频源：
          </Text>
          <Radio.Group
            value={selectedSourceStem}
            onChange={(e) => setSelectedSourceStem(e.target.value)}
            style={{ width: "100%" }}
          >
            <Row gutter={[8, 8]}>
              {sourceOptions.map((opt) => (
                <Col key={opt.value} span={12} md={8}>
                  <Radio.Button
                    value={opt.value}
                    style={{
                      width: "100%",
                      height: 48,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                      borderRadius: 6,
                    }}
                  >
                    {opt.icon} {opt.label}
                  </Radio.Button>
                </Col>
              ))}
            </Row>
          </Radio.Group>
        </div>

        <Row gutter={24}>
          {/* 左侧：音色/乐器选择 */}
          <Col span={14}>
            <Text strong style={{ display: "block", marginBottom: 8 }}>
              选择目标音色或乐器：
            </Text>
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索音色或乐器..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ marginBottom: 12 }}
              allowClear
            />

            <div style={{ marginBottom: 12 }}>
              <Space wrap>
                {CATEGORIES.map((cat) => (
                  <Button
                    key={cat}
                    size="small"
                    type={categoryFilter === cat ? "primary" : "default"}
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat}
                  </Button>
                ))}
              </Space>
            </div>

            <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {filteredVoices.map((voice) => {
                const isInstrument = voice.category === "乐器模仿";
                const isSelected = selectedVoice?.id === voice.id;
                return (
                  <Card
                    key={voice.id}
                    size="small"
                    hoverable
                    loading={converting && isSelected}
                    style={{
                      borderColor: isSelected ? (isInstrument ? "#52c41a" : "#1F4788") : undefined,
                      background: isSelected
                        ? (isInstrument ? "#f6ffed" : "#f0f5ff")
                        : (isInstrument ? "#fafff5" : undefined),
                      cursor: converting ? "not-allowed" : "pointer",
                      transition: "all 0.2s",
                    }}
                    onClick={() => !converting && handleConvert(voice)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <Text strong style={{ fontSize: isInstrument ? 15 : 14 }}>
                          {isInstrument && "🎵 "}{voice.name}
                        </Text>
                        <Tag
                          color={isInstrument ? "green" : "default"}
                          style={{ marginLeft: 8, fontSize: 11 }}
                        >
                          {isInstrument ? "🎻 乐器" : voice.category}
                        </Tag>
                      </div>
                      <Space>
                        {isSelected && !converting && <CheckOutlined style={{ color: "#1F4788" }} />}
                        {converting && isSelected && (
                          <span style={{ fontSize: 12, color: "#666" }}>转换中...</span>
                        )}
                      </Space>
                    </div>
                    {isInstrument && (
                      <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                        用人声旋律模拟 {voice.name.replace(/[🎹🎸🎻🎵🎺]/g, "").trim()} 音色
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </Col>

          {/* 右侧：参数 + 播放 */}
          <Col span={10}>
            <Text strong style={{ display: "block", marginBottom: 16 }}>
              音色参数调节
            </Text>

            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text>音高偏移</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {voiceParams.pitchShift > 0 ? `+${voiceParams.pitchShift}` : voiceParams.pitchShift} 半音
                </Text>
              </div>
              <Slider
                min={-12}
                max={12}
                value={voiceParams.pitchShift}
                onChange={(v) => setVoiceParams({ pitchShift: v })}
                marks={{ "-12": "-12", "-6": "-6", "0": "0", "6": "+6", "12": "+12" }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text>转换强度</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{voiceParams.intensity}%</Text>
              </div>
              <Slider
                min={0}
                max={100}
                value={voiceParams.intensity}
                onChange={(v) => setVoiceParams({ intensity: v })}
                marks={{ "0": "弱", "50": "中", "100": "强" }}
              />
            </div>

            {/* 转换进度 */}
            {progress > 0 && progress < 100 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{progressMsg}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{Math.round(progress)}%</Text>
                </div>
                <Progress
                  percent={Math.round(progress)}
                  status="active"
                  strokeColor={selectedVoice?.category === "乐器模仿" ? "#52c41a" : "#1F4788"}
                  size="small"
                />
              </div>
            )}

            {/* 试听区域 - 带进度条 */}
            {previewUrl && (
              <div
                style={{
                  background: "#f5f5f5",
                  borderRadius: 8,
                  padding: "12px 16px",
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <Button
                    type="primary"
                    shape="circle"
                    icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                    onClick={handlePlayPause}
                    size="large"
                    style={{
                      background: selectedVoice?.category === "乐器模仿" ? "#52c41a" : "#1F4788",
                      borderColor: selectedVoice?.category === "乐器模仿" ? "#52c41a" : "#1F4788",
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <Text strong style={{ fontSize: 13 }}>
                      {selectedVoice?.name || "已转换音频"}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                      {isPlaying ? "播放中..." : "点击播放"}
                    </Text>
                  </div>
                </div>

                {/* 播放进度条 */}
                <Progress
                  percent={playbackPercent}
                  showInfo={false}
                  strokeColor={selectedVoice?.category === "乐器模仿" ? "#52c41a" : "#1F4788"}
                  size="small"
                  style={{ marginBottom: 4 }}
                />
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11, color: "#888" }}>
                    {playbackTimeStr(currentTime || 0)}
                  </Text>
                  <Text style={{ fontSize: 11, color: "#888" }}>
                    {playbackTimeStr(duration || 0)}
                  </Text>
                </div>
              </div>
            )}

            {!previewUrl && !converting && (
              <Text type="secondary" style={{ fontSize: 12, display: "block", textAlign: "center", marginTop: 20 }}>
                💡 先在上方选一个音频源，再点击左侧音色/乐器进行转换
              </Text>
            )}
          </Col>
        </Row>

        <div style={{ marginTop: 24, borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
          <Space>
            <Button onClick={onPrev} icon={<LeftOutlined />}>
              返回分离
            </Button>
            <Button
              type="primary"
              size="large"
              onClick={onNext}
              icon={<RightOutlined />}
              disabled={!selectedVoice}
            >
              进入导出
            </Button>
          </Space>
        </div>
      </div>
    </div>
  );
};

export default StepVoiceConvert;
