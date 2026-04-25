/**
 * hash.js
 * SHA-256 hashing for lossless verification using WebCrypto API.
 */

const HashEngine = (() => {
  /**
   * Compute SHA-256 of an ArrayBuffer.
   * Returns hex string.
   */
  async function sha256(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Verify two buffers are identical by comparing their SHA-256 hashes.
   * Returns { match: bool, hashA: string, hashB: string }
   */
  async function verify(bufferA, bufferB) {
    const [hashA, hashB] = await Promise.all([
      sha256(bufferA),
      sha256(bufferB),
    ]);
    return {
      match: hashA === hashB,
      hashA,
      hashB,
    };
  }

  /**
   * Truncate a hash to a displayable short form (first 16 chars + ...).
   */
  function short(hash) {
    return hash.slice(0, 16) + '...';
  }

  return { sha256, verify, short };
})();
