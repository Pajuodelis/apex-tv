import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const missing = error => error.code === 'ENOENT';
async function readOptional(file) {
  try { return await fs.readFile(file, 'utf8'); } catch (error) { if (missing(error)) return ''; throw error; }
}
function publicDer(key, jwk = false) {
  return crypto.createPublicKey(jwk ? { key, format: 'jwk' } : key).export({ format: 'der', type: 'spki' });
}
export async function recoverInstalledIdentity({ root, stateDirectory, legacyDirectory }) {
  const bootText = await readOptional(path.join(root, 'tv/connection.js'));
  if (!bootText) return false;
  const boot = JSON.parse(bootText.replace(/^\s*window\.APEX_CONFIG\s*=\s*/, '').replace(/;\s*$/, ''));
  // A public standalone package has no companion pairing to recover.
  if (!boot.server && !boot.pairingKey) return false;
  const expected = publicDer(boot.publicKey, true);
  const keyFile = path.join(stateDirectory, 'update-private.pem');
  const pairFile = path.join(stateDirectory, 'tv-key.txt');
  const current = await readOptional(keyFile), currentPair = await readOptional(pairFile);
  if (current && publicDer(current).equals(expected) && currentPair.trim() === boot.pairingKey) return false;
  // Recover only this app's original identity and only if both installed pins match.
  const previous = await readOptional(path.join(legacyDirectory, 'update-private.pem'));
  const previousPair = await readOptional(path.join(legacyDirectory, 'tv-key.txt'));
  if (!previous || !publicDer(previous).equals(expected) || !/^[a-f0-9]{64}$/.test(previousPair.trim()) || previousPair.trim() !== boot.pairingKey) {
    throw new Error('Kompiuterio ir įrašytos TV programėlės raktai nesutampa. Reikia atkurti pradinę Apex TV raktų kopiją.');
  }
  await fs.mkdir(stateDirectory, { recursive: true });
  const stamp = Date.now();
  if (current) await fs.copyFile(keyFile, keyFile + '.' + stamp + '.bak', fs.constants.COPYFILE_EXCL);
  if (currentPair) await fs.copyFile(pairFile, pairFile + '.' + stamp + '.bak', fs.constants.COPYFILE_EXCL);
  for (const [file, value] of [[keyFile, previous], [pairFile, previousPair]]) {
    const temp = file + '.recovery.tmp';
    await fs.writeFile(temp, value, { mode: 0o600 });
    await fs.rename(temp, file);
  }
  return true;
}