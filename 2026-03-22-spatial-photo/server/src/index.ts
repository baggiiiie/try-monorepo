import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processRouter } from './routes/process.js';

const app = express();
const port = Number(process.env.PORT ?? 8787);
const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const processedRoot = path.join(serverRoot, 'data/processed');
const uploadsRoot = path.join(serverRoot, 'uploads');
const clientDistRoot = path.resolve(serverRoot, '../client/dist');

await fs.mkdir(processedRoot, { recursive: true });
await fs.mkdir(uploadsRoot, { recursive: true });
const hasClientDist = await pathExists(clientDistRoot);

app.use(cors());
app.use(express.json());
app.use('/processed', express.static(processedRoot));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.use('/api/process', processRouter);

if (hasClientDist) {
  app.use(express.static(clientDistRoot));
  app.get(/^\/(?!api|processed).*/, (_request, response) => {
    response.sendFile(path.join(clientDistRoot, 'index.html'));
  });
}

app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({ error: error.message });
});

app.listen(port, () => {
  console.log(`Spatial photo server listening on http://localhost:${port}`);
});

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
