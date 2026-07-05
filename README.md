# MultiTrack - AI 音轨分离与人声变声系统

## 简介

MultiTrack 是一个基于深度学习的音轨分离与人声变声系统。核心分离引擎采用 **Demucs v4 (Hybrid Transformer Demucs)**，相比传统 STFT 信号处理方法，分离效果有质的飞跃。

## 技术栈

- **前端**: React + TypeScript + Vite
- **后端**: Python FastAPI
- **分离引擎**: Demucs Hybrid Transformer (Meta Research)
- **频谱可视化**: Canvas 2D 实时渲染 + 12 平均律

## 快速启动

`ash
# 1. 启动后端
cd src/backend
python api/server.py
# 后端运行在 http://127.0.0.1:8756

# 2. 启动前端
cd src/frontend
pnpm install
pnpm dev
# 前端运行在 http://localhost:5173
`

## 使用步骤

1. **导入** — 上传 MP3/WAV/FLAC 音频文件
2. **分离** — 点击分离，等待 Demucs 模型处理（约 30-120s）
3. **试听** — 分别试听人声和伴奏音轨
4. **变声** — 对人声音轨应用不同音色
5. **导出** — 导出分离或变声后的音频

## 技术文档

详见 [docs/技术架构文档.md](docs/技术架构文档.md)

## 许可证

MIT
