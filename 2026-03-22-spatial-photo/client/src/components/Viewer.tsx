import { useEffect, useRef } from 'react';
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

  return (
    <section className="viewer-shell panel">
      <div className="viewer-header">
        <div>
          <p className="eyebrow">Viewer</p>
          <h2>Pointer-driven depth warp</h2>
        </div>
        <p className="muted">Move the pointer gently for the cleanest parallax effect.</p>
      </div>
      <div ref={containerRef} className="viewer-canvas" />
      {!props.result ? <div className="viewer-empty">Upload a spatial photo to render it here.</div> : null}
    </section>
  );
}
