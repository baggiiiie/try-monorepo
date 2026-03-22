import type { ProcessedSpatialPhoto } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

function resolveAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url)) {
    return url;
  }

  if (API_BASE) {
    return `${API_BASE}${url}`;
  }

  return url;
}

export async function processSpatialPhoto(file: File): Promise<ProcessedSpatialPhoto> {
  const formData = new FormData();
  formData.append('spatialPhoto', file);

  const response = await fetch(`${API_BASE}/api/process`, {
    method: 'POST',
    body: formData
  });

  const payload = (await response.json()) as ProcessedSpatialPhoto | { error: string };

  if (!response.ok || 'error' in payload) {
    throw new Error('error' in payload ? payload.error : 'Unknown upload error');
  }

  return {
    ...payload,
    baseImageUrl: resolveAssetUrl(payload.baseImageUrl),
    depthMapUrl: resolveAssetUrl(payload.depthMapUrl),
    rightImageUrl: payload.rightImageUrl ? resolveAssetUrl(payload.rightImageUrl) : undefined
  };
}
