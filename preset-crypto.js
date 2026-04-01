/**
 * cloud-preset 암·복호화 (AES-GCM-256, PBKDF2-SHA256 10만 회)
 * 브라우저 Web Crypto API 전용. Node에서는 사용하지 마세요.
 */
(function () {
  const PBKDF2_ITER = 100000;

  function u8ToB64(u8) {
    let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  function b64ToU8(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveAesKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  /**
   * @param {object} plainObj - { owner, repo, branch?, path?, token? }
   * @param {string} password
   * @returns {Promise<{ v: number, salt: string, iv: string, ciphertext: string }>}
   */
  async function encryptPreset(plainObj, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAesKey(password, salt);
    const pt = new TextEncoder().encode(JSON.stringify(plainObj));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt));
    return {
      v: 1,
      salt: u8ToB64(salt),
      iv: u8ToB64(iv),
      ciphertext: u8ToB64(ct),
    };
  }

  /**
   * @param {{ v: number, salt: string, iv: string, ciphertext: string }} payload
   * @param {string} password
   * @returns {Promise<object>}
   */
  async function decryptPreset(payload, password) {
    if (!payload || payload.v !== 1 || !payload.salt || !payload.iv || !payload.ciphertext) {
      throw new Error("잘못된 암호화 프리셋 형식입니다.");
    }
    const salt = b64ToU8(payload.salt);
    const iv = b64ToU8(payload.iv);
    const ct = b64ToU8(payload.ciphertext);
    const key = await deriveAesKey(password, salt);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    const json = new TextDecoder().decode(pt);
    return JSON.parse(json);
  }

  window.PresetCrypto = { encryptPreset, decryptPreset, PBKDF2_ITER };
})();
