import { execSync } from 'node:child_process';

// ffmpeg ships via winget here, which puts a shim on PATH but not always in a place
// `where` resolves under a service account — so fall back to scanning the package store.
function find(): string {
  try { return execSync('where ffmpeg', { encoding: 'utf8' }).split('\n')[0]!.trim(); } catch {}
  const winget = `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Packages`;
  try {
    const hits = execSync(`dir /s /b "${winget}\\ffmpeg.exe" 2>nul`, { encoding: 'utf8', shell: 'cmd.exe' }).split('\n');
    const found = hits.find(p => p.trim().endsWith('ffmpeg.exe'));
    if (found) return found.trim();
  } catch {}
  return 'ffmpeg';
}

export const FFMPEG: string = find();
