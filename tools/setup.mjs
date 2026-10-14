import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { root, stateDir } from '../companion/paths.mjs';
export async function setup({ writeConnection = true, stateDirectory = stateDir } = {}) {
  await fs.mkdir(stateDirectory, { recursive: true });
  let configText;
  try { configText = await fs.readFile(process.env.APEX_COMPANION_CONFIG || path.join(root, 'companion/config.json'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; configText = await fs.readFile(path.join(root, 'companion/config.example.json'), 'utf8'); }
  const config = JSON.parse(configText);
  function localAddress(address) {
    if (isIP(address) !== 4) return false;
    const [a, b] = address.split('.').map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (!localAddress(config.pcAddress) || !localAddress(config.tvAddress) ||
      !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Netinkama vietinio tinklo konfigūracija.');
  const keyPath = path.join(stateDirectory, 'update-private.pem');
  let pem;
  try { pem = await fs.readFile(keyPath, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
    await fs.writeFile(keyPath, pem, { mode: 0o600 });
  }
  const pairPath = path.join(stateDirectory, 'tv-key.txt');
  let pairingKey;
  try { pairingKey = (await fs.readFile(pairPath, 'utf8')).trim(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; pairingKey = crypto.randomBytes(32).toString('hex'); await fs.writeFile(pairPath, pairingKey, { mode: 0o600 }); }
  const publicKey = crypto.createPublicKey(pem).export({ format: 'jwk' });
  const boot = { server: 'http://' + config.pcAddress + ':' + config.port, pairingKey, publicKey, shell: 1, bundledVersion: '0.5.3' };
  if (writeConnection) await fs.writeFile(path.join(root, 'tv/connection.js'), 'window.APEX_CONFIG = ' + JSON.stringify(boot) + ';\n');
  return { config, pairingKey, privateKey: crypto.createPrivateKey(pem), publicKey, stateDir: stateDirectory };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, 'tools/setup.mjs')) {
  await setup();
  console.log('TV ryšio konfigūracija paruošta. Asmeniniai F1 duomenys į paketą neįtraukiami.');
}
