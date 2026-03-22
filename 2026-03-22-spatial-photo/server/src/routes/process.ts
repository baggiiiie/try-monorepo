import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { AppleHeicExtractor } from '../services/spatialExtractor.js';
import { prepareBaseImage, prepareDebugRightImage } from '../services/imagePipeline.js';
import { buildDepthMap } from '../services/depthEstimator.js';
import type { ProcessedSpatialPhoto } from '../types/index.js';

const serverRoot = fileURLToPath(new URL('../..', import.meta.url));

const upload = multer({
  dest: path.join(serverRoot, 'uploads'),
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

const extractor = new AppleHeicExtractor();
const processedRoot = path.join(serverRoot, 'data/processed');

export const processRouter = Router();

processRouter.post('/', upload.single('spatialPhoto'), async (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'Upload a .HEIC spatial photo using the field name spatialPhoto.' });
    return;
  }

  const id = crypto.randomUUID();
  const workingDir = path.join(processedRoot, id, 'work');
  const outputDir = path.join(processedRoot, id);

  try {
    await fs.mkdir(workingDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    const extracted = await extractor.extract(request.file.path, workingDir);
    const useEmbeddedDepth = Boolean(extracted.embeddedDepthPath);
    const baseSourcePath = useEmbeddedDepth
      ? extracted.primaryImagePath
      : extracted.leftImagePath ?? extracted.primaryImagePath;

    const preparedBase = await prepareBaseImage(baseSourcePath, outputDir);
    const depth = await buildDepthMap({
      baseImagePath: preparedBase.path,
      outputDir,
      embeddedDepthPath: extracted.embeddedDepthPath,
      leftImagePath: extracted.leftImagePath,
      rightImagePath: extracted.rightImagePath
    });

    if (!depth) {
      throw new Error('Depth processing failed unexpectedly.');
    }

    let rightImageUrl: string | undefined;
    if (extracted.rightImagePath) {
      await prepareDebugRightImage(extracted.rightImagePath, outputDir);
      rightImageUrl = `/processed/${id}/right.png`;
    }

    const payload: ProcessedSpatialPhoto = {
      id,
      baseImageUrl: `/processed/${id}/base.png`,
      depthMapUrl: `/processed/${id}/depth.png`,
      rightImageUrl,
      metadata: {
        width: preparedBase.width,
        height: preparedBase.height,
        extractor: 'apple-heic',
        depthSource: depth.source,
        hasStereoPair: Boolean(extracted.leftImagePath && extracted.rightImagePath),
        normalization: depth.normalization
      }
    };

    response.json(payload);
  } catch (error) {
    await fs.rm(outputDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : 'Unknown processing error';
    response.status(500).json({ error: `Failed to process spatial photo. ${message}` });
  } finally {
    await fs.rm(request.file.path, { force: true });
    await fs.rm(workingDir, { recursive: true, force: true });
  }
});
