import type { ProcessedSpatialPhoto, ViewerControls } from '../types';

interface ControlsPanelProps {
  controls: ViewerControls;
  result: ProcessedSpatialPhoto | null;
  disabled: boolean;
  onChange: (next: ViewerControls) => void;
  onResetView: () => void;
  onReprocess: () => void;
}

export function ControlsPanel(props: ControlsPanelProps) {
  const setValue = <Key extends keyof ViewerControls>(key: Key, value: ViewerControls[Key]) => {
    props.onChange({
      ...props.controls,
      [key]: value
    });
  };

  return (
    <section className="panel controls-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Controls</p>
          <h2>Viewer tuning</h2>
        </div>
        <div className="panel-actions">
          <button type="button" className="ghost-button" onClick={props.onResetView} disabled={props.disabled}>
            Reset view
          </button>
          <button type="button" className="ghost-button" onClick={props.onReprocess} disabled={props.disabled}>
            Reprocess
          </button>
        </div>
      </div>

      <label className="control-row">
        <span>Depth strength</span>
        <input
          type="range"
          min="0.2"
          max="1.5"
          step="0.01"
          value={props.controls.depthStrength}
          onChange={(event) => setValue('depthStrength', Number(event.target.value))}
          disabled={props.disabled}
        />
        <strong>{props.controls.depthStrength.toFixed(2)}</strong>
      </label>

      <label className="control-row">
        <span>Motion amount</span>
        <input
          type="range"
          min="0.004"
          max="0.04"
          step="0.001"
          value={props.controls.motionRange}
          onChange={(event) => setValue('motionRange', Number(event.target.value))}
          disabled={props.disabled}
        />
        <strong>{props.controls.motionRange.toFixed(3)}</strong>
      </label>

      <label className="control-row">
        <span>Edge smoothing</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={props.controls.edgeSmoothing}
          onChange={(event) => setValue('edgeSmoothing', Number(event.target.value))}
          disabled={props.disabled}
        />
        <strong>{props.controls.edgeSmoothing.toFixed(2)}</strong>
      </label>

      <div className="toggle-group">
        <label>
          <input
            type="checkbox"
            checked={props.controls.showDepth}
            onChange={(event) =>
              props.onChange({
                ...props.controls,
                showDepth: event.target.checked,
                showBase: event.target.checked ? false : props.controls.showBase
              })
            }
            disabled={props.disabled}
          />
          Show depth map
        </label>
        <label>
          <input
            type="checkbox"
            checked={props.controls.showBase}
            onChange={(event) =>
              props.onChange({
                ...props.controls,
                showBase: event.target.checked,
                showDepth: event.target.checked ? false : props.controls.showDepth
              })
            }
            disabled={props.disabled}
          />
          Show raw base image
        </label>
      </div>

      {props.result ? (
        <div className="meta-grid">
          <div>
            <span>Resolution</span>
            <strong>
              {props.result.metadata.width} × {props.result.metadata.height}
            </strong>
          </div>
          <div>
            <span>Depth source</span>
            <strong>{props.result.metadata.depthSource === 'embedded-aux-depth' ? 'Embedded aux depth' : 'Stereo fallback'}</strong>
          </div>
          <div>
            <span>Stereo pair</span>
            <strong>{props.result.metadata.hasStereoPair ? 'Available' : 'Missing'}</strong>
          </div>
          <div>
            <span>Normalization</span>
            <strong>
              {props.result.metadata.normalization.inputMin} → {props.result.metadata.normalization.inputMax}
            </strong>
          </div>
        </div>
      ) : (
        <p className="muted">Process a file to enable the viewer controls.</p>
      )}
    </section>
  );
}
