// Automatic cloud backup to a private (secret) GitHub Gist using the user's own token.
// Photos are not included — they stay on the phone.

const FILE = 'promise-backup.json';
const API = 'https://api.github.com/gists';

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
}

export async function backupToGist(token: string, json: string, gistId?: string): Promise<string> {
  const body = JSON.stringify({ description: 'Promise gym tracker backup', public: false, files: { [FILE]: { content: json } } });
  const res = await fetch(gistId ? `${API}/${gistId}` : API, { method: gistId ? 'PATCH' : 'POST', headers: headers(token), body });
  if (res.status === 404 && gistId) return backupToGist(token, json); // gist was deleted — make a new one
  if (!res.ok) throw new Error(res.status === 401 ? 'GitHub token rejected — check it has the "gist" scope.' : `Backup failed (${res.status})`);
  return (await res.json()).id as string;
}

export async function restoreFromGist(token: string, gistId: string): Promise<string> {
  const res = await fetch(`${API}/${gistId}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Couldn't read the backup (${res.status})`);
  const file = (await res.json()).files?.[FILE];
  if (!file) throw new Error('No Promise backup in that gist.');
  if (file.truncated && file.raw_url) return (await fetch(file.raw_url)).text();
  return file.content as string;
}
