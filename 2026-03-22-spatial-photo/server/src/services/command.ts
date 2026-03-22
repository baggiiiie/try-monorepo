import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function ensureBinary(binary: string): Promise<void> {
  const pathEnv = process.env.PATH ?? '';

  for (const directory of pathEnv.split(':')) {
    if (!directory) {
      continue;
    }

    try {
      await access(`${directory}/${binary}`, constants.X_OK);
      return;
    } catch {
      // Continue searching PATH.
    }
  }

  throw new Error(`Required binary not found on PATH: ${binary}`);
}

export async function runCommand(command: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    });

    return [stdout, stderr].filter(Boolean).join('\n');
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${details}`);
  }
}
