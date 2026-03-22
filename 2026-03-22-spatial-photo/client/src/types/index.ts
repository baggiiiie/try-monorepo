export interface ProcessedSpatialPhoto {
  id: string;
  baseImageUrl: string;
  depthMapUrl: string;
  rightImageUrl?: string;
  metadata: {
    width: number;
    height: number;
    extractor: 'apple-heic';
    depthSource: 'embedded-aux-depth' | 'stereo-fallback';
    hasStereoPair: boolean;
    normalization: {
      inputMin: number;
      inputMax: number;
    };
  };
}

export interface ViewerControls {
  depthStrength: number;
  motionRange: number;
  edgeSmoothing: number;
  showDepth: boolean;
  showBase: boolean;
}
