import React, { useState, useRef } from "react";
import { Button, Slider, Card, Row, Col, Space, Tag, Typography, Input, message } from "antd";
import { SoundOutlined, LeftOutlined, RightOutlined, CheckOutlined, SearchOutlined, PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { useAppStore, VoicePreset } from "../stores/appStore";
import { convertVoice, fetchVoices, getAudioUrl } from "../utils/api";
import { useAudioPlayer } from "../utils/useAudioPlayer";

const { Text } = Typography;

const CATEGORIES = ["全部", "男声", "女声", "特效"];

const StepVoiceConvert: React.FC<{ onNext: () => void; onPrev: () => void }> = ({ onNext, onPrev }) => {
  const { audioFile, stems, selectedVoice, setSelectedVoice, voiceParams, setVoiceParams, setConvertedVocalsPath, processing, setProcessing } = useAppStore();
  const { isPlaying, play, pause, stop } = useAudioPlayer();
  const [categoryFilter, setCategoryFilter] = useState("全部");
  const [searchText, setSearchText] = useState("");
  const [voiceList, setVoiceList] = useState<VoicePreset[]>([]);
  const [converting, setConverting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Load voices from backend on mount
  React.useEffect(() => {
    fetchVoices().then((data) => {
      const presets: VoicePreset[] = data.builtin.map((v: any) => ({
        id: v.id, name: v.name, category: v.category, isBuiltin: true,
      }));
      setVoiceList(presets);
    }).catch(() => {
      // Fallback: use hardcoded list
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
      ]);
    });
  }, []);

  const filteredVoices = voiceList.filter((v) => {
    if (categoryFilter !== "全部" && v.category !== categoryFilter) return false;
    if (searchText && !v.name.includes(searchText)) return false;
    return true;
  });

  const handleConvert = async (voice: VoicePreset) => {
    setSelectedVoice(voice);

    // Get the vocals path from stems
    const vocalsStem = stems.find((s) => s.type === "vocals");
    const vocalsPath = audioFile?.uploadedPath || vocalsStem?.filePath;

    if (!vocalsPath) {
      message.warning("没有人声音轨可转换");
      // Fallback: use the uploaded audio file if available
      if (audioFile?.fileObj) {
        // We need to upload it first then convert
        message.info("请先完成音轨分离");
      }
      return;
    }

    setConverting(true);
    message.loading({ content: "正在转换音色...", key: "convert" });

    try {
      const result = await convertVoice(
        vocalsPath, voice.id,
        voiceParams.pitchShift, voiceParams.intensity
      );

      if (result.status === "success") {
        const url = getAudioUrl(result.path);
        setPreviewUrl(url);
        setConvertedVocalsPath(result.path);
        message.success({ content: "音色转换完成！", key: "convert" });
      } else {
        message.error({ content: "转换失败", key: "convert" });
      }
    } catch (e: any) {
      console.error("Convert error:", e);
      message.warning({ content: "后端转换失败，请检查后端服务", key: "convert", duration: 3 });
    }

    setConverting(false);
  };

  const handlePreview = () => {
    if (isPlaying) {
      pause();
      return;
    }
    if (previewUrl) {
      play(previewUrl);
    }
  };

  return (
    <div className="step-card active" style={{ maxWidth: 800, margin: "0 auto", width: "100%" }}>
      <div className="step-header">
        <div className="step-number active">3</div>
        <span className="step-title">人声变声翻唱</span>
        {selectedVoice && <Tag color="blue">{selectedVoice.name}</Tag>}
        {previewUrl && <Tag color="green">已转换</Tag>}
      </div>

      <div className="step-content">
        <Row gutter={24}>
          <Col span={14}>
            <Text strong style={{ display: "block", marginBottom: 8 }}>选择目标音色</Text>
            <Input prefix={<SearchOutlined />} placeholder="搜索音色..." value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ marginBottom: 12 }} />

            <div style={{ marginBottom: 12 }}>
              <Space wrap>
                {CATEGORIES.map((cat) => (
                  <Button key={cat} size="small" type={categoryFilter === cat ? "primary" : "default"} onClick={() => setCategoryFilter(cat)}>{cat}</Button>
                ))}
              </Space>
            </div>

            <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {filteredVoices.map((voice) => (
                <Card
                  key={voice.id}
                  size="small"
                  hoverable
                  style={{
                    borderColor: selectedVoice?.id === voice.id ? "#1F4788" : undefined,
                    background: selectedVoice?.id === voice.id ? "#f0f5ff" : undefined,
                  }}
                  onClick={() => handleConvert(voice)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <Text strong>{voice.name}</Text>
                      <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{voice.category}</Text>
                    </div>
                    <Space>
                      {selectedVoice?.id === voice.id && <CheckOutlined style={{ color: "#1F4788" }} />}
                      {converting && selectedVoice?.id === voice.id && <span>转换中...</span>}
                    </Space>
                  </div>
                </Card>
              ))}
            </div>
          </Col>

          <Col span={10}>
            <Text strong style={{ display: "block", marginBottom: 16 }}>音色参数调节</Text>

            <div style={{ marginBottom: 20 }}>
              <Text style={{ display: "block", marginBottom: 4 }}>音高偏移</Text>
              <Slider min={-12} max={12} value={voiceParams.pitchShift} onChange={(v) => setVoiceParams({ pitchShift: v })} marks={{ "-12": "-12", "-6": "-6", "0": "0", "6": "+6", "12": "+12" }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <Text style={{ display: "block", marginBottom: 4 }}>转换强度</Text>
              <Slider min={0} max={100} value={voiceParams.intensity} onChange={(v) => setVoiceParams({ intensity: v })} marks={{ "0": "弱", "50": "中", "100": "强" }} />
            </div>

            {previewUrl && (
              <Button
                type="default"
                icon={isPlaying ? <StopOutlined /> : <PlayCircleOutlined />}
                block
                onClick={handlePreview}
                style={{ marginBottom: 8 }}
              >
                {isPlaying ? "停止播放" : "试听变声效果"}
              </Button>
            )}

            {!previewUrl && (
              <Text type="secondary" style={{ fontSize: 12, display: "block", textAlign: "center" }}>
                点击左侧音色卡片进行转换
              </Text>
            )}
          </Col>
        </Row>

        <div style={{ marginTop: 24, borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
          <Space>
            <Button onClick={onPrev} icon={<LeftOutlined />}>返回分离</Button>
            <Button type="primary" size="large" onClick={onNext} icon={<RightOutlined />} disabled={!selectedVoice}>
              进入导出
            </Button>
          </Space>
        </div>
      </div>
    </div>
  );
};

export default StepVoiceConvert;
