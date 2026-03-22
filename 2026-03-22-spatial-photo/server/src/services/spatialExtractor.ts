import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ensureBinary, runCommand } from './command.js';
import type { ExtractionResult } from '../types/index.js';

export interface SpatialPhotoExtractor {
  extract(inputPath: string, outputDir: string): Promise<ExtractionResult>;
}

interface IndexedImage {
  filePath: string;
  index: number;
  width: number;
  height: number;
}

export class AppleHeicExtractor implements SpatialPhotoExtractor {
  async extract(inputPath: string, outputDir: string): Promise<ExtractionResult> {
    await ensureBinary('heif-convert');
    await mkdir(outputDir, { recursive: true });

    const outputBase = path.join(outputDir, 'extract.png');
    await runCommand('heif-convert', ['--with-aux', inputPath, outputBase]);

    const files = await readdir(outputDir);
    const indexedImages = await this.loadIndexedImages(
      files
        .filter((file) => /^extract-\d+\.png$/.test(file))
        .map((file) => path.join(outputDir, file))
    );

    if (indexedImages.length === 0) {
      throw new Error('No decodable images were extracted from the HEIC container.');
    }

    indexedImages.sort((a, b) => a.index - b.index);

    const primaryImage = indexedImages.reduce((largest, current) => {
      const largestArea = largest.width * largest.height;
      const currentArea = current.width * current.height;
      return currentArea > largestArea ? current : largest;
    });

    const stereoPair = indexedImages
      .filter((image) => image.filePath !== primaryImage.filePath)
      .sort((a, b) => a.index - b.index)
      .slice(0, 2);

    const embeddedDepthPath = files.find((file) => file.endsWith('-depth.png'))
      ? path.join(outputDir, files.find((file) => file.endsWith('-depth.png')) as string)
      : undefined;

    return {
      primaryImagePath: primaryImage.filePath,
      leftImagePath: stereoPair[0]?.filePath,
      rightImagePath: stereoPair[1]?.filePath,
      embeddedDepthPath
    };
  }

  private async loadIndexedImages(paths: string[]): Promise<IndexedImage[]> {
    const images = await Promise.all(
      paths.map(async (filePath) => {
        const match = filePath.match(/extract-(\d+)\.png$/);
        const metadata = await sharp(filePath).metadata();

        if (!match || !metadata.width || !metadata.height) {
          throw new Error(`Failed to inspect extracted image: ${filePath}`);
        }

        return {
          filePath,
          index: Number(match[1]),
          width: metadata.width,
          height: metadata.height
        } satisfies IndexedImage;
      })
    );

    return images;
  }
}
