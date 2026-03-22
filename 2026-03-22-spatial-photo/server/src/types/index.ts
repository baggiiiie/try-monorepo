export interface ExtractionResult {
  primaryImagePath: string;
  leftImagePath?: string;
  rightImagePath?: string;
  embeddedDepthPath?: string;
}

export type DepthSource = 'embedded-aux-depth' | 'stereo-fallback';

export interface DepthResult {
  depthPath: string;
  source: DepthSource;
  normalization: {
    inputMin: number;
    inputMax: number;
  };
}

export interface ProcessedSpatialPhoto {
  id: string;
  baseImageUrl: string;
  depthMapUrl: string;
  rightImageUrl?: string;
  metadata: {
    width: number;
    height: number;
    extractor: 'apple-heic';
    depthSource: DepthSource;
    hasStereoPair: boolean;
    normalization: {
      inputMin: number;
      inputMax: number;
    };
  };
}
