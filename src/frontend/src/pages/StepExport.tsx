import React, { useState } from "react";
import { Button, Radio, Select, Slider, Checkbox, Space, message, Progress, Typography, Input, Tag } from "antd";
import {
  DownloadOutlined,
  LeftOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { useAppStore } from "../stores/appStore";
import { processPipeline, getAudioUrl } from "../utils/api";
import { useAudioPlayer } from "../utils/useAudioPlayer";

const { Text } = Typography;

const FORMAT_OPTIONS = [
  { value: "wav", label: "WAV (无损)", extensions: "16/24/32-bit" },
  { value: "mp3", label: "MP3 (通用)", extensions: "128/256/320 kbps" },
  { value: "flac", label: "FLAC (压缩无损)", extensions: "压缩级别 0-8" },
];

const BITRATE_MAP: Record<string, number[]> = {
  wav: [16, 24, 32],
  mp3: [128, 192, 256, 320],
  flac: [0, 3, 5, 8],
};

const BITRATE_LABEL: Record<string, string> = {
  "16": "16-bit", "24": "24-bit", "32": "32-bit float",
  "128": "128 kbps", "192": "192 kbps", "256": "256 kbps", "320": "320 kbps",
  "0": "最快压缩", "3": "平衡", "5": "高压缩", "8": "最大压缩",
};

const StepExport: React.FC<{ onPrev: () => void; onReset: () => void }> = ({ onPrev, onReset }) => {
  const { audioFile, stems, updateStem, selectedVoice, exportConfig, setExportConfig, setProcessing, processing, processingProgress, processingStatus, setProcessingProgress } = useAppStore();
  const { isPlaying, play, pause } = useAudioPlayer();
  const [exported, setExported] = useState(false);
  const [exportPath, setExportPath] = useState("");

  const handleExport = async () => {
    if (!audioFile?.fileObj) {
      message.error('没有可导出的音频文件');
      return;
    }

    setProcessing(true);
    setProcessingProgress(5, "正在处理管道...");

    try {
      const voice_id = selectedVoice?.id;
      const voice_params = JSON.stringify({
        pitchShift: 0,
        intensity: 80,
      });

      // Build stem config from mixer settings
      const stem_cfg: Record<string, any> = {};
      stems.forEach((s) => {
        stem_cfg[s.type] = {
          volume: s.volume / 100,
          pan: s.pan / 100,
          muted: !s.active,
        };
      });

      const result = await processPipeline(
        audioFile.fileObj,
        "2stems",
        voice_id,
        voice_params,
        exportConfig.format,
        exportConfig.bitrate,
        exportConfig.includeStems,
        JSON.stringify(stem_cfg)
      );

      if (result.status === "success") {
        setExportPath(result.export_path);
        setExported(true);
        setProcessingProgress(100, "导出成功");
        message.success('导出成功！');
      } else {
        message.error('导出失败：' + result.message);
      }
    } catch (e: any) {
      console.error("Export error:", e);
      // Fallback: show download link if file was created
      message.warning('后端导出失败，请检查后端服务');
    }

    setProcessing(false);
  };

  const handlePreviewExport = () => {
    if (exportPath) {
      const url = getAudioUrl(exportPath);
      if (isPlaying) {
        pause();
      } else {
        play(url);
      }
    }
  };

  const currentBitrates = BITRATE_MAP[exportConfig.format] || BITRATE_MAP.mp3;

  return (
    <div className="step-card active" style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
      <div className="step-header">
        <div className="step-number active">4</div>
        <span className="step-title">混音与导出</span>
        {exported && <Tag color="success">已导出 ✓</Tag>}
      </div>

      <div className="step-content">
        {/* Stem mixer */}
        <Text strong style={{ display: "block", marginBottom: 12 }}>音轨混音器</Text>
        <div className="mixer-controls">
          {stems.map((stem) => (
            <div className="mixer-row" key={stem.id}>
              <div className="mixer-label">
                <Checkbox
                  checked={stem.active}
                  onChange={(e) => updateStem(stem.id, { active: e.target.checked })}
                >
                  {stem.name}
                </Checkbox>
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                <Text type="secondary" style={{ fontSize: 12, width: 24 }}>音量</Text>
                <Slider
                  style={{ flex: 1, margin: "0 8px" }}
                  min={0}
                  max={150}
                  value={stem.volume}
                  onChange={(v) => updateStem(stem.id, { volume: v })}
                />
                <Text style={{ fontSize: 12, width: 36 }}>{stem.volume}%</Text>
              </div>
              <div style={{ width: 120, display: "flex", alignItems: "center", gap: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>声像</Text>
                <Slider
                  style={{ flex: 1, margin: "0 4px" }}
                  min={-100}
                  max={100}
                  value={stem.pan}
                  onChange={(v) => updateStem(stem.id, { pan: v })}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Export format */}
        <div style={{ marginTop: 20 }}>
          <Text strong style={{ display: "block", marginBottom: 8 }}>导出格式</Text>
          <Radio.Group
            value={exportConfig.format}
            onChange={(e) => setExportConfig({ format: e.target.value, bitrate: currentBitrates[0] })}
            optionType="button"
            buttonStyle="solid"
            style={{ marginBottom: 12 }}
          >
            {FORMAT_OPTIONS.map((opt) => (
              <Radio.Button key={opt.value} value={opt.value}>
                {opt.label}
              </Radio.Button>
            ))}
          </Radio.Group>

          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ display: "block", marginBottom: 4 }}>质量/比特率</Text>
            <Select
              value={exportConfig.bitrate}
              onChange={(v) => setExportConfig({ bitrate: v })}
              options={currentBitrates.map((b) => ({
                value: b,
                label: BITRATE_LABEL[b.toString()] || `${b}`,
              }))}
              style={{ width: 160 }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <Checkbox
              checked={exportConfig.includeStems}
              onChange={(e) => setExportConfig({ includeStems: e.target.checked })}
            >
              同时导出各音轨独立文件
            </Checkbox>
          </div>
        </div>

        {/* Processing */}
        {processing && (
          <div className="progress-container">
            <div className="progress-info">
              <span>{processingStatus}</span>
              <span>{processingProgress}%</span>
            </div>
            <Progress percent={processingProgress} status="active" strokeColor="#1F4788" />
          </div>
        )}

        {/* Export result */}
        {exported && (
          <div style={{ padding: 16, background: "#f6ffed", borderRadius: 8, margin: "16px 0", border: "1px solid #b7eb8f" }}>
            <Space>
              <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 20 }} />
              <div>
                <Text strong>导出成功！</Text>
                <div>
                  <Text type="secondary">{exportPath}</Text>
                </div>
                <Button size="small" icon={<PlayCircleOutlined />} onClick={handlePreviewExport} style={{ marginTop: 4 }}>
                  {isPlaying ? "停止" : "试听导出结果"}
                </Button>
              </div>
            </Space>
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 24, borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
          <Space>
            <Button onClick={onPrev} icon={<LeftOutlined />}>返回变声</Button>
            {!exported ? (
              <Button type="primary" size="large" icon={<DownloadOutlined />} onClick={handleExport} loading={processing}>
                导出
              </Button>
            ) : (
              <Button type="primary" icon={<ReloadOutlined />} onClick={onReset}>
                开始新项目
              </Button>
            )}
          </Space>
        </div>
      </div>
    </div>
  );
};

export default StepExport;

