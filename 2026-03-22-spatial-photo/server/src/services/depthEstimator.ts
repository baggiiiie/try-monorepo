import path from 'node:path';
import sharp from 'sharp';
import type { DepthResult } from '../types/index.js';

interface GrayscaleImage {
  data: Uint8Array;
  width: number;
  height: number;
}

interface EstimateDepthOptions {
  baseImagePath: string;
  outputDir: string;
  embeddedDepthPath?: string;
  leftImagePath?: string;
  rightImagePath?: string;
}

export async function buildDepthMap(options: EstimateDepthOptions): Promise<DepthResult> {
  const { embeddedDepthPath, leftImagePath, rightImagePath } = options;

  if (embeddedDepthPath) {
    return normalizeEmbeddedDepth(embeddedDepthPath, options.baseImagePath, options.outputDir);
  }

  if (leftImagePath && rightImagePath) {
    return estimateStereoDepth(leftImagePath, rightImagePath, options.baseImagePath, options.outputDir);
  }

  throw new Error('Could not create a depth map because neither aux depth nor a stereo pair was available.');
}

async function normalizeEmbeddedDepth(
  embeddedDepthPath: string,
  baseImagePath: string,
  outputDir: string
): Promise<DepthResult> {
  const baseMetadata = await sharp(baseImagePath).metadata();

  if (!baseMetadata.width || !baseMetadata.height) {
    throw new Error('Could not read base image dimensions for depth normalization.');
  }

  const { data } = await sharp(embeddedDepthPath)
    .rotate()
    .resize({
      width: baseMetadata.width,
      height: baseMetadata.height,
      fit: 'fill'
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const normalized = normalizeArray(new Uint8Array(data), baseMetadata.width, baseMetadata.height, { blurPasses: 2 });
  const depthPath = path.join(outputDir, 'depth.png');

  await sharp(Buffer.from(normalized.data), {
    raw: {
      width: baseMetadata.width,
      height: baseMetadata.height,
      channels: 1
    }
  })
    .png({ compressionLevel: 9 })
    .toFile(depthPath);

  return {
    depthPath,
    source: 'embedded-aux-depth',
    normalization: {
      inputMin: normalized.inputMin,
      inputMax: normalized.inputMax
    }
  };
}

async function estimateStereoDepth(
  leftImagePath: string,
  rightImagePath: string,
  baseImagePath: string,
  outputDir: string
): Promise<DepthResult> {
  const workingWidth = 320;
  const left = await loadGrayscale(leftImagePath, workingWidth);
  const right = await loadGrayscale(rightImagePath, workingWidth, left.width, left.height);
  const direction = detectDirection(left, right);
  const disparity = computeDisparity(left, right, direction);
  const normalized = normalizeArray(disparity, left.width, left.height, { blurPasses: 3 });

  const baseMetadata = await sharp(baseImagePath).metadata();

  if (!baseMetadata.width || !baseMetadata.height) {
    throw new Error('Could not read base image metadata for stereo depth resizing.');
  }

  const depthPath = path.join(outputDir, 'depth.png');

  await sharp(Buffer.from(normalized.data), {
    raw: {
      width: left.width,
      height: left.height,
      channels: 1
    }
  })
    .resize({
      width: baseMetadata.width,
      height: baseMetadata.height,
      fit: 'fill',
      kernel: 'mitchell'
    })
    .png({ compressionLevel: 9 })
    .toFile(depthPath);

  return {
    depthPath,
    source: 'stereo-fallback',
    normalization: {
      inputMin: normalized.inputMin,
      inputMax: normalized.inputMax
    }
  };
}

async function loadGrayscale(
  imagePath: string,
  width: number,
  forcedWidth?: number,
  forcedHeight?: number
): Promise<GrayscaleImage> {
  const pipeline = sharp(imagePath).rotate().greyscale();

  if (forcedWidth && forcedHeight) {
    pipeline.resize({ width: forcedWidth, height: forcedHeight, fit: 'fill' });
  } else {
    pipeline.resize({ width, withoutEnlargement: true });
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

  return {
    data: new Uint8Array(data),
    width: info.width,
    height: info.height
  };
}

function detectDirection(left: GrayscaleImage, right: GrayscaleImage): -1 | 1 {
  const maxDisparity = Math.max(4, Math.min(24, Math.floor(left.width / 10)));
  const sampleStep = 24;
  let negativeCost = 0;
  let positiveCost = 0;

  for (let y = sampleStep; y < left.height - sampleStep; y += sampleStep) {
    for (let x = sampleStep + maxDisparity; x < left.width - sampleStep - maxDisparity; x += sampleStep) {
      negativeCost += bestDirectionalCost(left, right, x, y, maxDisparity, -1);
      positiveCost += bestDirectionalCost(left, right, x, y, maxDisparity, 1);
    }
  }

  return negativeCost <= positiveCost ? -1 : 1;
}

function bestDirectionalCost(
  left: GrayscaleImage,
  right: GrayscaleImage,
  x: number,
  y: number,
  maxDisparity: number,
  direction: -1 | 1
): number {
  let bestCost = Number.POSITIVE_INFINITY;

  for (let disparity = 0; disparity <= maxDisparity; disparity += 2) {
    const targetX = x + disparity * direction;

    if (targetX < 1 || targetX >= right.width - 1) {
      continue;
    }

    let cost = 0;

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      const leftRow = (y + offsetY) * left.width;
      const rightRow = (y + offsetY) * right.width;

      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const leftValue = left.data[leftRow + x + offsetX];
        const rightValue = right.data[rightRow + targetX + offsetX];
        cost += Math.abs(leftValue - rightValue);
      }
    }

    if (cost < bestCost) {
      bestCost = cost;
    }
  }

  return bestCost;
}

function computeDisparity(left: GrayscaleImage, right: GrayscaleImage, direction: -1 | 1): Uint8Array {
  const width = left.width;
  const height = left.height;
  const maxDisparity = Math.max(6, Math.min(40, Math.floor(width / 7)));
  const disparity = new Uint8Array(width * height);
  const halfWindow = 2;

  for (let y = halfWindow; y < height - halfWindow; y += 1) {
    for (let x = halfWindow + maxDisparity; x < width - halfWindow - maxDisparity; x += 1) {
      let bestCost = Number.POSITIVE_INFINITY;
      let secondBest = Number.POSITIVE_INFINITY;
      let bestDisparity = 0;

      for (let offset = 0; offset <= maxDisparity; offset += 1) {
        const sampleX = x + offset * direction;

        if (sampleX < halfWindow || sampleX >= width - halfWindow) {
          continue;
        }

        let cost = 0;

        for (let windowY = -halfWindow; windowY <= halfWindow; windowY += 1) {
          const leftRow = (y + windowY) * width;
          const rightRow = (y + windowY) * width;

          for (let windowX = -halfWindow; windowX <= halfWindow; windowX += 1) {
            const leftValue = left.data[leftRow + x + windowX];
            const rightValue = right.data[rightRow + sampleX + windowX];
            cost += Math.abs(leftValue - rightValue);
          }
        }

        if (cost < bestCost) {
          secondBest = bestCost;
          bestCost = cost;
          bestDisparity = offset;
        } else if (cost < secondBest) {
          secondBest = cost;
        }
      }

      const uniqueEnough = secondBest === Number.POSITIVE_INFINITY || bestCost < secondBest * 0.94;
      disparity[y * width + x] = uniqueEnough ? Math.round((bestDisparity / maxDisparity) * 255) : 0;
    }
  }

  fillEmptyPixels(disparity, width, height);
  return disparity;
}

function fillEmptyPixels(data: Uint8Array, width: number, height: number): void {
  for (let pass = 0; pass < 2; pass += 1) {
    const copy = new Uint8Array(data);

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;

        if (copy[index] !== 0) {
          continue;
        }

        let sum = 0;
        let count = 0;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) {
              continue;
            }

            const value = copy[(y + offsetY) * width + (x + offsetX)];
            if (value > 0) {
              sum += value;
              count += 1;
            }
          }
        }

        if (count >= 4) {
          data[index] = Math.round(sum / count);
        }
      }
    }
  }
}

function normalizeArray(
  data: Uint8Array,
  width: number,
  height: number,
  options: { blurPasses: number }
): { data: Uint8Array; inputMin: number; inputMax: number } {
  const filteredValues = Array.from(data).filter((value) => value > 0);

  if (filteredValues.length === 0) {
    throw new Error('Depth estimation produced an empty depth map.');
  }

  filteredValues.sort((a, b) => a - b);
  const minIndex = Math.floor(filteredValues.length * 0.02);
  const maxIndex = Math.floor(filteredValues.length * 0.98);
  const inputMin = filteredValues[minIndex] ?? filteredValues[0];
  const inputMax = filteredValues[maxIndex] ?? filteredValues[filteredValues.length - 1];
  const range = Math.max(1, inputMax - inputMin);

  const normalized = new Uint8Array(data.length);

  for (let index = 0; index < data.length; index += 1) {
    const scaled = ((data[index] - inputMin) / range) * 255;
    normalized[index] = clampByte(Math.round(scaled));
  }

  let blurred: Uint8Array = normalized;
  for (let pass = 0; pass < options.blurPasses; pass += 1) {
    blurred = boxBlur(blurred, width, height);
  }

  return {
    data: blurred,
    inputMin,
    inputMax
  };
}

function boxBlur(data: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(data.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;

          if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) {
            continue;
          }

          sum += data[sampleY * width + sampleX];
          count += 1;
        }
      }

      output[y * width + x] = Math.round(sum / Math.max(1, count));
    }
  }

  return output;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}
