import { useMemo, useState } from 'react';
import { processSpatialPhoto } from './api/processSpatialPhoto';
import { UploadPanel } from './components/UploadPanel';
import { ControlsPanel } from './components/ControlsPanel';
import { Viewer } from './components/Viewer';
import type { ProcessedSpatialPhoto, ViewerControls } from './types';

const defaultControls: ViewerControls = {
  depthStrength: 0.68,
  motionRange: 0.018,
  edgeSmoothing: 0.45,
  showDepth: false,
  showBase: false
};

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<ProcessedSpatialPhoto | null>(null);
  const [controls, setControls] = useState<ViewerControls>(defaultControls);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);

  const statusText = useMemo(() => {
    if (isProcessing) {
      return 'Processing upload, extracting HEIC assets, and preparing depth…';
    }

    if (result) {
return `Ready. ${result.metadata.depthSource === 'embedded-aux-depth' ? 'Using embedded Apple aux depth.' : 'Using stereo fallback depth.'}`;
}

    return 'No image loaded yet.';
  }, [isProcessing, result]);

  const handleProcess = async (file: File) => {
    setSelectedFile(file);
    setError(null);
    setIsProcessing(true);

    try {
      const nextResult = await processSpatialPhoto(file);
      setResult(nextResult);
      setResetSignal((value) => value + 1);
    } catch (processingError) {
      setResult(null);
      setError(processingError instanceof Error ? processingError.message : 'Unknown processing error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="app-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Spatial photo prototype</p>
          <h1>Desktop parallax viewer for iPhone spatial photos</h1>
          <p className="muted max-width">
            This prototype extracts assets on the server, then uses a single-image depth warp in three.js for a stable,
            monoscopic spatial-photo feel.
          </p>
        </div>
        <div className="status-badge">{statusText}</div>
      </div>

      <div className="layout-grid">
        <div className="sidebar">
          <UploadPanel
            isProcessing={isProcessing}
            error={error}
            fileName={selectedFile?.name ?? null}
            onFileSelected={(file) => void handleProcess(file)}
          />
          <ControlsPanel
            controls={controls}
            result={result}
            disabled={!result || isProcessing}
            onChange={setControls}
            onResetView={() => setResetSignal((value) => value + 1)}
            onReprocess={() => {
              if (selectedFile) {
                void handleProcess(selectedFile);
              }
            }}
          />
        </div>

        <div className="content-column">
          <Viewer result={result} controls={controls} resetSignal={resetSignal} />
          {result?.rightImageUrl ? (
            <section className="panel debug-panel">
              <div className="viewer-header">
                <div>
                  <p className="eyebrow">Debug</p>
                  <h2>Extracted right-eye image</h2>
                </div>
              </div>
              <img className="debug-image" src={result.rightImageUrl} alt="Extracted right-eye view" />
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
