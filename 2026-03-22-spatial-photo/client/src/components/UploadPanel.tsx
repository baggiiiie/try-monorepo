import { useRef } from 'react';

interface UploadPanelProps {
  isProcessing: boolean;
  error: string | null;
  fileName: string | null;
  onFileSelected: (file: File) => void;
}

export function UploadPanel(props: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) {
      return;
    }

    props.onFileSelected(file);
  };

  return (
    <section className="panel upload-panel">
      <div
        className={`dropzone ${props.isProcessing ? 'is-disabled' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!props.isProcessing) {
            handleFiles(event.dataTransfer.files);
          }
        }}
      >
        <p className="eyebrow">Spatial photo</p>
        <h1>Upload an iPhone spatial photo</h1>
        <p className="muted">
          The server extracts the HEIC payload, prepares a depth map, then the browser renders subtle motion parallax.
        </p>
        <div className="upload-actions">
          <button
            type="button"
            className="primary-button"
            disabled={props.isProcessing}
            onClick={() => inputRef.current?.click()}
          >
            {props.isProcessing ? 'Processing…' : 'Choose .HEIC file'}
          </button>
          <span className="upload-hint">or drag and drop</span>
        </div>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".heic,.HEIC,image/heic,image/heif"
          onChange={(event) => handleFiles(event.target.files)}
        />
        {props.fileName ? <p className="file-pill">Current file: {props.fileName}</p> : null}
        {props.error ? <p className="error-text">{props.error}</p> : null}
      </div>
    </section>
  );
}
