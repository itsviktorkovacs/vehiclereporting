// crypto-utils.js
// PBKDF2-SHA256 (210k iter) + AES-256-GCM, per the reusable serverless-encrypted-app pattern.
// Used both by the deployed frontend (decrypt) and by tools/prepare-data (encrypt) —
// the tools/ copy of this file is identical, kept in sync manually (no build step).

(function (global) {
  const PBKDF2_ITERATIONS = 210000;

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function b64ToBuf(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function deriveKey(password, saltBuf, usage) {
    const baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBuf, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, [usage]
    );
  }

  // Encrypts a JS object with a password. Returns {salt, iv, ciphertext} all base64.
  async function encryptJSON(password, obj) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, 'encrypt');
    const plaintext = new TextEncoder().encode(JSON.stringify(obj));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return {
      salt: bufToB64(salt),
      iv: bufToB64(iv),
      ciphertext: bufToB64(ciphertext),
    };
  }

  // Decrypts a {salt, iv, ciphertext} record with a password. Throws on wrong password.
  async function decryptJSON(password, record) {
    const salt = b64ToBuf(record.salt);
    const iv = b64ToBuf(record.iv);
    const ciphertext = b64ToBuf(record.ciphertext);
    const key = await deriveKey(password, salt, 'decrypt');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  global.CryptoUtils = { encryptJSON, decryptJSON };
})(window);
