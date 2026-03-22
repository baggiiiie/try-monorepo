import { useEffect, useRef, useState } from 'react';
import { ViewerScene } from '../three/viewerScene';
import type { ProcessedSpatialPhoto, ViewerControls } from '../types';

interface ViewerProps {
  result: ProcessedSpatialPhoto | null;
  controls: ViewerControls;
  resetSignal: number;
}

export function Viewer(props: ViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ViewerScene | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scene = new ViewerScene(container);
    sceneRef.current = scene;
    scene.updateControls(props.controls);

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.updateControls(props.controls);
  }, [props.controls]);

  useEffect(() => {
    if (!props.result || !sceneRef.current) {
      return;
    }

    void sceneRef.current.load(props.result.baseImageUrl, props.result.depthMapUrl).catch((error) => {
      console.error('Failed to load viewer textures', error);
    });
  }, [props.result]);

  useEffect(() => {
    sceneRef.current?.resetView();
  }, [props.resetSignal]);

  useEffect(() => {
    if (!props.result) {
      setShowFullscreenPrompt(false);
      return;
    }

    setShowFullscreenPrompt(true);
    const timeout = window.setTimeout(() => {
      setShowFullscreenPrompt(false);
    }, 1000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [props.result?.id]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleEnterFullscreen = async () => {
    if (!props.result || !containerRef.current || document.fullscreenElement) {
      return;
    }

    try {
      await containerRef.current.requestFullscreen();
    } catch (error) {
      console.error('Failed to enter fullscreen mode', error);
    }
  };

  return (
    <section className="viewer-shell panel">
      <div className="viewer-header">
        <div>
          <p className="eyebrow">Viewer</p>
          <h2>Pointer-driven depth warp</h2>
        </div>
        <p className="muted">Move the pointer gently for the cleanest parallax effect.</p>
      </div>
      <div
        ref={containerRef}
        className={`viewer-canvas ${props.result ? 'is-clickable' : ''} ${isFullscreen ? 'is-fullscreen' : ''}`}
        onClick={() => void handleEnterFullscreen()}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && props.result) {
            event.preventDefault();
            void handleEnterFullscreen();
          }
        }}
        role={props.result ? 'button' : undefined}
        tabIndex={props.result ? 0 : -1}
        aria-label={props.result ? 'Open viewer in fullscreen' : undefined}
      >
        {props.result && showFullscreenPrompt && !isFullscreen ? (
          <div className="viewer-fullscreen-prompt" aria-hidden="true">
            <div className="viewer-fullscreen-prompt__icon">⤢</div>
            <div className="viewer-fullscreen-prompt__text">Click to view fullscreen</div>
          </div>
        ) : null}
        {props.result && isFullscreen ? (
          <div className="viewer-fullscreen-hint">Press Esc to exit fullscreen</div>
        ) : null}
      </div>
      {!props.result ? <div className="viewer-empty">Upload a spatial photo to render it here.</div> : null}
    </section>
  );
}
