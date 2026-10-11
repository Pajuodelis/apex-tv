import crypto from 'node:crypto';
import { ServiceError } from './f1.mjs';
// The signed envelope carries only ciphertext, for the paired TV's ephemeral key.
export async function sealTVSession(token, recipient, signingKey) {
  if (typeof token !== 'string' || !token || token.length > 32000 || !recipient || recipient.kty !== 'EC' || recipient.crv !== 'P-256' || !/^[A-Za-z0-9_-]{43}$/.test(recipient.x || '') || !/^[A-Za-z0-9_-]{43}$/.test(recipient.y || '') || recipient.d) throw new ServiceError('Netinkamas TV sesijos raktas.', 400);
  const subtle = crypto.webcrypto.subtle;
  let publicKey; try { publicKey = await subtle.importKey('jwk', { kty:'EC', crv:'P-256', x:recipient.x, y:recipient.y, ext:true }, {name:'ECDH',namedCurve:'P-256'}, false, []); } catch { throw new ServiceError('Netinkamas TV sesijos raktas.', 400); }
  const own = await subtle.generateKey({name:'ECDH',namedCurve:'P-256'}, true, ['deriveBits']);
  const secret = await subtle.deriveBits({name:'ECDH',public:publicKey}, own.privateKey, 256);
  const aes = await subtle.importKey('raw', secret, {name:'AES-GCM'}, false, ['encrypt']);
  const iv = crypto.randomBytes(12);
  const ciphertext = await subtle.encrypt({name:'AES-GCM',iv}, aes, Buffer.from(JSON.stringify({token})));
  const payload = Buffer.from(JSON.stringify({version:1, publicKey:await subtle.exportKey('jwk',own.publicKey), iv:iv.toString('base64'), ciphertext:Buffer.from(ciphertext).toString('base64')})).toString('base64');
  return {payload, signature:crypto.sign('RSA-SHA256', Buffer.from(payload,'base64'),signingKey).toString('base64')};
}