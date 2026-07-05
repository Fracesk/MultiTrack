import React, { useState } from 'react';
import { Button, message, Steps } from 'antd';
import {
  UploadOutlined,
  NodeIndexOutlined,
  SoundOutlined,
  DownloadOutlined,
  CustomerServiceOutlined,
} from '@ant-design/icons';
import StepImport from './pages/StepImport';
import StepSeparate from './pages/StepSeparate';
import StepVoiceConvert from './pages/StepVoiceConvert';
import StepExport from './pages/StepExport';
import { useAppStore } from './stores/appStore';

const STEP_ITEMS = [
  { title: '导入音频', icon: <UploadOutlined /> },
  { title: '音轨分离', icon: <NodeIndexOutlined /> },
  { title: '变声翻唱', icon: <SoundOutlined /> },
  { title: '混音导出', icon: <DownloadOutlined /> },
];

const App: React.FC = () => {
  const { currentStep, setCurrentStep, audioFile, stems, reset } = useAppStore();
  const [stepStatus, setStepStatus] = useState<('process' | 'finish' | 'wait' | 'error')[]>([
    'process', 'wait', 'wait', 'wait',
  ]);

  const handleStepClick = (step: number) => {
    // Only allow clicking completed steps or current
    if (step <= currentStep + 1 && step >= 0 && step <= 3) {
      setCurrentStep(step);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <StepImport onNext={() => { setCurrentStep(1); updateStepStatus(0); }} />;
      case 1:
        return <StepSeparate onNext={() => { setCurrentStep(2); updateStepStatus(1); }} onPrev={() => setCurrentStep(0)} />;
      case 2:
        return <StepVoiceConvert onNext={() => { setCurrentStep(3); updateStepStatus(2); }} onPrev={() => setCurrentStep(1)} />;
      case 3:
        return <StepExport onPrev={() => setCurrentStep(2)} onReset={reset} />;
      default:
        return null;
    }
  };

  const updateStepStatus = (completedStep: number) => {
    setStepStatus((prev) => {
      const next = [...prev];
      next[completedStep] = 'finish';
      if (completedStep + 1 < 4) next[completedStep + 1] = 'process';
      return next;
    });
  };

  return (
    <div className="workspace-container">
      <header className="workspace-header">
        <CustomerServiceOutlined style={{ fontSize: 24, color: '#1F4788' }} />
        <h1>VoiceCraft</h1>
        <span style={{ marginLeft: 8, color: '#999', fontSize: 13 }}>AI 音轨分离与变声翻唱系统</span>
      </header>

      <div className="workspace-body">
        <Steps
          current={currentStep}
          status={stepStatus[currentStep] === 'error' ? 'error' : 'process'}
          items={STEP_ITEMS}
          style={{ padding: '0 24px', maxWidth: 800, margin: '0 auto' }}
        />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {renderStep()}
        </div>
      </div>
    </div>
  );
};

export default App;
