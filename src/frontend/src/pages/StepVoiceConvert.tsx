import React, { useState, useRef, useEffect } from "react";
import {
  Button, Slider, Card, Row, Col, Space, Tag, Typography,
  Input, message, Progress, Radio, Divider, Alert, Tabs, Tooltip,
} from "antd";
import {
  LeftOutlined, RightOutlined, CheckOutlined,
  SearchOutlined, PlayCircleOutlined, PauseCircleOutlined,
  AudioOutlined, InfoCircleOutlined, SoundOutlined,
} from "@ant-design/icons";
import { useAppStore, VoicePreset } from "../stores/appStore";
import { convertVoice, fetchVoices, getAudioUrl } from "../utils/api";
import { useAudioPlayer } from "../utils/useAudioPlayer";
import SpectrogramViewer from "../components/SpectrogramViewer";

const { Text } = Typography;

/** 类别筛选按钮 */
const CATEGORIES = [
  { key: "全部", label: "全部" },
  { key: "男声", label: "🎤 男声" },
  { key: "女声", label: "🎤 女声" },
  { key: "特效", label: "✨ 特效" },
  { key: "乐器模仿", label: "🎻 乐器演奏" },
];

const StepVoiceConvert: React.FC<{ onNext: () => void; onPrev: () => void }> = ({ onNext, onPrev }) => {
  const {
    audioFile, stems, selectedVoice, setSelectedVoice,
    voiceParams, setVoiceParams, setConvertedVocalsPath, processing, setProcessing,
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

  // ----- 可选音频源 -----
  const sourceOptions: { label: string; value: string; icon: string }[] = [];
  if (audioFile?.uploadedPath || audioFile?.path) {
    sourceOptions.push({ label: "原始音频", value: audioFile?.uploadedPath || audioFile?.path || "", icon: "🎵" });
  }
  stems.forEach((s) => {
    sourceOptions.push({ label: s.name, value: s.filePath, icon: s.type === "vocals" ? "🎤" : s.type === "accompaniment" ? "🎶" : "🎵" });
  });

  useEffect(() => {
    if (!selectedSourceStem && sourceOptions.length > 0) {
      const vocals = sourceOptions.find((o) => o.icon === "🎤");
      setSelectedSourceStem(vocals?.value || sourceOptions[0].value);
    }
  }, [stems, audioFile]);

  // ----- 加载音色列表 -----
  useEffect(() => {
    fetchVoices().then((data) => {
      const all: VoicePreset[] = [];
      (data.builtin || []).forEach((v: any) => all.push({ id: v.id, name: v.name, category: v.category, isBuiltin: true }));
      (data.instrument || []).forEach((v: any) => all.push({ id: v.id, name: v.name, category: v.category, isBuiltin: true }));
      setVoiceList(all);
    }).catch(() => {
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
        { id: "instrument-piano", name: "🎹 钢琴", category: "乐器模仿", isBuiltin: true },
        { id: "instrument-guitar", name: "🎸 吉他", category: "乐器模仿", isBuiltin: true },
        { id: "instrument-violin", name: "🎻 小提琴", category: "乐器模仿", isBuiltin: true },
        { id: "instrument-flute", name: "🎵 长笛", category: "乐器模仿", isBuiltin: true },
        { id: "instrument-trumpet", name: "🎺 小号", category: "乐器模仿", isBuiltin: true },
      ]);
    });
  }, []);

  const isInstrumentMode = selectedVoice?.category === "乐器模仿";
  const filteredVoices = voiceList.filter((v) => {
    if (categoryFilter !== "全部" && v.category !== categoryFilter) return false;
    if (searchText && !v.name.includes(searchText)) return false;
    return true;
  });

  // ----- 进度模拟 -----
  const startProgress = () => {
    setProgress(0);
    setProgressMsg(isInstrumentMode ? "正在分析旋律..." : "正在处理...");
    if (intervalRef.current) clearInterval(intervalRef.current);
    let p = 0;
    intervalRef.current = window.setInterval(() => {
      p += 2 + Math.random() * 3;
      if (isInstrumentMode) {
        if (p < 20) setProgressMsg("正在提取音高...");
        else if (p < 40) setProgressMsg("正在识别音符序列...");
        else if (p < 60) setProgressMsg(`正在用${selectedVoice?.name || "乐器"}演奏...`);
        else if (p < 85) setProgressMsg("正在合成音频...");
        else setProgressMsg("即将完成");
      } else {
        if (p < 30) setProgressMsg("正在调整音高...");
        else if (p < 60) setProgressMsg("正在应用音色...");
        else if (p < 85) setProgressMsg("正在合成...");
        else setProgressMsg("即将完成");
      }
      setProgress(Math.min(94, p));
    }, 400);
  };

  const stopProgress = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setProgress(100);
    setProgressMsg("完成");
    setTimeout(() => { setProgress(0); setProgressMsg(""); }, 1200);
  };

  // ----- 转换 -----
  const handleConvert = async (voice: VoicePreset) => {
    setSelectedVoice(voice);
    if (!selectedSourceStem) { message.warning("请先选择一个音频源"); return; }
    setConverting(true);
    startProgress();
    try {
      const result = await convertVoice(selectedSourceStem, voice.id, voiceParams.pitchShift, voiceParams.intensity);
      if (result.status === "success") {
        setPreviewUrl(getAudioUrl(result.path));
        setConvertedVocalsPath(result.path);
        stopProgress();
        message.success({ content: isInstrumentMode ? `🎵 ${voice.name} 演奏完成` : "转换完成", key: "convert", duration: 3 });
      } else {
        stopProgress();
        message.error({ content: "转换失败", key: "convert" });
      }
    } catch (e: any) {
      stopProgress();
      message.warning({ content: "后端转换失败，请检查后端是否已启动", key: "convert", duration: 3 });
    }
    setConverting(false);
  };

  const handlePlayPause = () => {
    if (isPlaying) { pause(); return; }
    if (previewUrl) { stop(); play(previewUrl); }
  };

  const playbackPercent = duration && duration > 0 ? ((currentTime || 0) / duration) * 100 : 0;
  const fmtTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ----- 渲染 -----
  return (
    <div className="step-card active" style={{ maxWidth: 950, margin: "0 auto", width: "100%" }}>
      <div className="step-header">
        <div className="step-number active">3</div>
        <span className="step-title">
          {isInstrumentMode ? "🎻 乐器演奏旋律" : "🎛️ 人声变声"}
        </span>
        {selectedVoice && <Tag color={isInstrumentMode ? "green" : "blue"}>{selectedVoice.name}</Tag>}
        {previewUrl && <Tag color="green">✅ 已完成</Tag>}
      </div>

      <div className="step-content">
        {/* 模式说明 */}
        {isInstrumentMode && (
          <Alert type="info" showIcon icon={<InfoCircleOutlined />}
            message="🎻 乐器演奏模式"
            description="系统会从音频中提取旋律音高（音符序列），然后用所选乐器的音色重新演奏这段旋律。"
            style={{ marginBottom: 16, background: "#f6ffed", border: "1px solid #b7eb8f" }}
          />
        )}

        {/* 选择音频源 */}
        <div style={{ marginBottom: 16, padding: "12px 16px", background: isInstrumentMode ? "#f6ffed" : "#f9f9ff", borderRadius: 8, border: isInstrumentMode ? "1px solid #b7eb8f" : "1px solid #e8e8f0" }}>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            <AudioOutlined /> 选择要处理的音频：
          </Text>
          <Radio.Group value={selectedSourceStem} onChange={(e) => setSelectedSourceStem(e.target.value)} style={{ width: "100%" }}>
            <Row gutter={[8, 8]}>
              {sourceOptions.map((opt) => (
                <Col key={opt.value} span={12} md={8}>
                  <Radio.Button value={opt.value} style={{ width: "100%", height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, borderRadius: 6 }}>
                    {opt.icon} {opt.label}
                  </Radio.Button>
                </Col>
              ))}
            </Row>
          </Radio.Group>
        </div>

        <Row gutter={24}>
          {/* 左侧：选择效果 */}
          <Col span={14}>
            <Text strong style={{ display: "block", marginBottom: 8 }}>选择效果：</Text>
            <Input prefix={<SearchOutlined />} placeholder="搜索..." value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ marginBottom: 12 }} allowClear />

            <div style={{ marginBottom: 12 }}>
              <Space wrap>
                {CATEGORIES.map((cat) => (
                  <Button key={cat.key} size="small"
                    type={categoryFilter === cat.key ? "primary" : "default"}
                    onClick={() => setCategoryFilter(cat.key)}
                    style={cat.key === "乐器模仿" && categoryFilter !== cat.key ? { borderColor: "#52c41a", color: "#52c41a" } : undefined}
                  >
                    {cat.label}
                  </Button>
                ))}
              </Space>
            </div>

            <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {filteredVoices.map((voice) => {
                const isInst = voice.category === "乐器模仿";
                const isSel = selectedVoice?.id === voice.id;
                return (
                  <Card key={voice.id} size="small" hoverable loading={converting && isSel}
                    style={{
                      borderColor: isSel ? (isInst ? "#52c41a" : "#1F4788") : undefined,
                      background: isSel ? (isInst ? "#f6ffed" : "#f0f5ff") : (isInst ? "#fafff5" : undefined),
                      cursor: converting ? "not-allowed" : "pointer",
                      opacity: converting && !isSel ? 0.5 : 1,
                    }}
                    onClick={() => !converting && handleConvert(voice)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <Text strong style={{ fontSize: isInst ? 15 : 14 }}>{voice.name}</Text>
                        <Tag color={isInst ? "green" : "default"} style={{ marginLeft: 8, fontSize: 11 }}>
                          {isInst ? "🎻 乐器" : voice.category}
                        </Tag>
                      </div>
                      {isSel && !converting && <CheckOutlined style={{ color: "#1F4788" }} />}
                      {converting && isSel && <span style={{ fontSize: 12, color: "#666" }}>处理中...</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                      {isInst ? "🎵 提取旋律 → 用乐器音色重新演奏" : "🗣️ 改变人声音色"}
                    </div>
                  </Card>
                );
              })}
            </div>
          </Col>

          {/* 右侧：参数 + 播放 */}
          <Col span={10}>
            <Text strong style={{ display: "block", marginBottom: 16 }}>参数调节</Text>

            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text>音高偏移</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{voiceParams.pitchShift > 0 ? `+${voiceParams.pitchShift}` : voiceParams.pitchShift} 半音</Text>
              </div>
              <Slider min={-12} max={12} value={voiceParams.pitchShift} onChange={(v) => setVoiceParams({ pitchShift: v })} marks={{ "-12": "-12", "-6": "-6", "0": "0", "6": "+6", "12": "+12" }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <Text>效果强度</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>{voiceParams.intensity}%</Text>
              </div>
              <Slider min={0} max={100} value={voiceParams.intensity} onChange={(v) => setVoiceParams({ intensity: v })} marks={{ "0": "弱", "50": "中", "100": "强" }} />
            </div>

            {/* 进度 */}
            {progress > 0 && progress < 100 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{progressMsg}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{Math.round(progress)}%</Text>
                </div>
                <Progress percent={Math.round(progress)} status="active" strokeColor={isInstrumentMode ? "#52c41a" : "#1F4788"} size="small" />
              </div>
            )}

            {/* 试听 */}
            {previewUrl && (
              <div style={{ background: isInstrumentMode ? "#f6ffed" : "#f5f5f5", borderRadius: 8, padding: "12px 16px", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <Button type="primary" shape="circle"
                    icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                    onClick={handlePlayPause} size="large"
                    style={{ background: isInstrumentMode ? "#52c41a" : "#1F4788", borderColor: isInstrumentMode ? "#52c41a" : "#1F4788" }}
                  />
                  <div style={{ flex: 1 }}>
                    <Text strong style={{ fontSize: 13 }}>{selectedVoice?.name || "已转换"}</Text>
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>{isPlaying ? "播放中" : "点击播放"}</Text>
                  </div>
                </div>
                <Progress percent={playbackPercent} showInfo={false} strokeColor={isInstrumentMode ? "#52c41a" : "#1F4788"} size="small" style={{ marginBottom: 4 }} />
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11, color: "#888" }}>{fmtTime(currentTime || 0)}</Text>
                  <Text style={{ fontSize: 11, color: "#888" }}>{fmtTime(duration || 0)}</Text>
                </div>
              </div>
            )}

            {!previewUrl && !converting && (
              <div style={{ marginTop: 20 }}>
                <Text type="secondary" style={{ fontSize: 12, display: "block", textAlign: "center" }}>
                  💡 先选音频源，再点击左侧效果开始处理
                </Text>
                <Divider style={{ fontSize: 11, color: "#ccc" }}>提示</Divider>
                <div style={{ fontSize: 11, color: "#888", textAlign: "center", lineHeight: 1.8 }}>
                  🎤 人声变声 → 改变音色气质<br />
                  🎻 乐器演奏 → 提取旋律用乐器演奏
                </div>
              </div>
            )}
          </Col>
        </Row>

        <div style={{ marginTop: 24, borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
          <Space>
            <Button onClick={onPrev} icon={<LeftOutlined />}>返回分离</Button>
            <Button type="primary" size="large" onClick={onNext} icon={<RightOutlined />} disabled={!selectedVoice}>进入导出</Button>
          </Space>
        </div>
      </div>
    </div>
  );
};

export default StepVoiceConvert;
