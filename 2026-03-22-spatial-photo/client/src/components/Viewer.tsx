import { useEffect, useRef, useState, useCallback } from 'react';
import { ViewerScene } from '../three/viewerScene';
import { WalkAroundScene } from '../three/walkAroundScene';
import type { ProcessedSpatialPhoto, ViewerControls } from '../types';

interface ViewerProps {
  result: ProcessedSpatialPhoto | null;
  controls: ViewerControls;
  resetSignal: number;
}

export function Viewer(props: ViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const walkContainerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ViewerScene | null>(null);
  const walkSceneRef = useRef<WalkAroundScene | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);
  const [walkAroundActive, setWalkAroundActive] = useState(false);

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

  // Walk-around fullscreen exit handler
  useEffect(() => {
    if (!walkAroundActive) return;

    const handleFsChange = () => {
      if (!document.fullscreenElement) {
        walkSceneRef.current?.dispose();
        walkSceneRef.current = null;
        setWalkAroundActive(false);
      }
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, [walkAroundActive]);

  // Initialize walk-around scene when container is ready
  useEffect(() => {
    if (!walkAroundActive || !walkContainerRef.current || !props.result) return;

    const container = walkContainerRef.current;

    const initWalkScene = async () => {
      try {
        await container.requestFullscreen();
      } catch {
        setWalkAroundActive(false);
        return;
      }

      const walkScene = new WalkAroundScene(container);
      walkSceneRef.current = walkScene;
      walkScene.updateControls(props.controls);

      try {
        await walkScene.load(props.result!.baseImageUrl, props.result!.depthMapUrl);
      } catch (error) {
        console.error('Failed to load walk-around textures', error);
      }
    };

    void initWalkScene();

    return () => {
      walkSceneRef.current?.dispose();
      walkSceneRef.current = null;
    };
  }, [walkAroundActive]);

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

  const handleEnterWalkAround = useCallback(() => {
    if (!props.result || walkAroundActive) return;
    setWalkAroundActive(true);
  }, [props.result, walkAroundActive]);

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
      {props.result ? (
        <button className="walk-around-button" onClick={handleEnterWalkAround}>
          <span className="walk-around-button__icon">🚶</span>
          <span>Walk Around in 3D</span>
        </button>
      ) : null}
      {!props.result ? <div className="viewer-empty">Upload a spatial photo to render it here.</div> : null}

      {walkAroundActive ? (
        <div ref={walkContainerRef} className="walk-around-overlay">
          <div className="walk-around-hud">
            <div className="walk-around-hud__controls">
              <span>WASD / Arrow keys — move</span>
              <span>Mouse — look around</span>
              <span>Click — lock cursor</span>
              <span>Esc — exit</span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
