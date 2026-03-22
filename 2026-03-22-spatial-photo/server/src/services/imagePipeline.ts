import path from 'node:path';
import sharp from 'sharp';

export interface PreparedImage {
  path: string;
  width: number;
  height: number;
}

async function toPng(inputPath: string, outputPath: string, maxWidth: number): Promise<PreparedImage> {
  const metadata = await sharp(inputPath).rotate().metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image metadata for ${inputPath}`);
  }

  const pipeline = sharp(inputPath).rotate();

  if (metadata.width > maxWidth) {
    pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  }

  await pipeline.png({ compressionLevel: 9 }).toFile(outputPath);

  const outputMetadata = await sharp(outputPath).metadata();

  if (!outputMetadata.width || !outputMetadata.height) {
    throw new Error(`Could not read processed image metadata for ${outputPath}`);
  }

  return {
    path: outputPath,
    width: outputMetadata.width,
    height: outputMetadata.height
  };
}

export async function prepareBaseImage(inputPath: string, outputDir: string): Promise<PreparedImage> {
  return toPng(inputPath, path.join(outputDir, 'base.png'), 2400);
}

export async function prepareDebugRightImage(inputPath: string, outputDir: string): Promise<PreparedImage> {
  return toPng(inputPath, path.join(outputDir, 'right.png'), 1800);
}
