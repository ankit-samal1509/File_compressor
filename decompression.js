/**
 * decompression.js
 * Handles decompression for all supported file types.
 * Reads the magic header written by compression.js to dispatch correctly.
 */

const DecompressionEngine = (() => {
  // Magic bytes
  const MAGIC = {
    TXT: [0x43, 0x4B, 0x54, 0x58, 0x54], // CKTXT
    WAV: [0x43, 0x4B, 0x57, 0x41, 0x56], // CKWAV
    MP4: [0x43, 0x4B, 0x4D, 0x50, 0x34], // CKMP4
  };

  function matchesMagic(uint8, magic) {
    for (let i = 0; i < magic.length; i++) {
      if (uint8[i] !== magic[i]) return false;
    }
    return true;
  }

  // Header: 5 magic bytes + 4 bytes (uint32) original size = 9 bytes
  const HEADER_SIZE = 9;

  function readHeader(uint8) {
    const magic5 = Array.from(uint8.slice(0, 5));
    const origLenBytes = uint8.slice(5, 9);
    const origLen = new DataView(origLenBytes.buffer, origLenBytes.byteOffset).getUint32(0, true);
    return { magic5, origLen };
  }

  // ─── GENERIC DEFLATE DECOMPRESS ─────────────────────────────────────────────

  function decompressDeflate(uint8, expectedOrigLen) {
    const payload = uint8.slice(HEADER_SIZE);
    const decompressed = fflate.inflateSync(payload);
    return decompressed;
  }

  // ─── TXT DECOMPRESS ─────────────────────────────────────────────────────────

  async function decompressText(buffer) {
    const uint8 = new Uint8Array(buffer);
    const { origLen } = readHeader(uint8);
    const decompressed = decompressDeflate(uint8, origLen);

    return {
      data: decompressed.buffer,
      outputExt: '.txt',
      outputMime: 'text/plain',
      algorithm: 'DEFLATE inflate',
      verifiableOriginalSize: origLen,
    };
  }

  // ─── PNG DECOMPRESS ─────────────────────────────────────────────────────────
  // UPNG-compressed PNGs are standard PNGs and can be loaded directly.
  // We just pass them through but confirm they are valid PNGs.

  async function decompressPNG(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target.result;
        try {
          // Validate via UPNG decode
          const img = UPNG.decode(buffer);
          if (!img || !img.width) throw new Error('Invalid PNG');

          resolve({
            data: buffer,
            outputExt: '.png',
            outputMime: 'image/png',
            algorithm: 'UPNG decode (passthrough)',
            note: 'UPNG-encoded PNGs are self-contained. Passthrough with validation.',
          });
        } catch (err) {
          reject(new Error('PNG decode failed: ' + err.message));
        }
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsArrayBuffer(file);
    });
  }

  // ─── JPEG DECOMPRESS ────────────────────────────────────────────────────────
  // JPEG is inherently lossy; we cannot truly "decompress" back to original.
  // We decode and re-present the image.

  async function decompressJPEG(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = e.target.result;
        const uint8 = new Uint8Array(buffer);

        // Verify JPEG signature: FF D8 FF
        if (uint8[0] !== 0xFF || uint8[1] !== 0xD8 || uint8[2] !== 0xFF) {
          return reject(new Error('Not a valid JPEG file'));
        }

        resolve({
          data: buffer,
          outputExt: '.jpg',
          outputMime: 'image/jpeg',
          algorithm: 'JPEG passthrough (lossy)',
          note: 'JPEG uses lossy DCT. Original pixel data cannot be fully reconstructed.',
          isLossy: true,
        });
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsArrayBuffer(file);
    });
  }

  // ─── WAV DECOMPRESS ─────────────────────────────────────────────────────────

  async function decompressWAV(buffer) {
    const uint8 = new Uint8Array(buffer);
    const { origLen } = readHeader(uint8);
    const decompressed = decompressDeflate(uint8, origLen);

    // Validate WAV header: RIFF....WAVE
    const riff = String.fromCharCode(decompressed[0], decompressed[1], decompressed[2], decompressed[3]);
    const wave = String.fromCharCode(decompressed[8], decompressed[9], decompressed[10], decompressed[11]);

    if (riff !== 'RIFF' || wave !== 'WAVE') {
      throw new Error('Decompressed data is not a valid WAV file');
    }

    return {
      data: decompressed.buffer,
      outputExt: '.wav',
      outputMime: 'audio/wav',
      algorithm: 'DEFLATE inflate',
      verifiableOriginalSize: origLen,
    };
  }

  // ─── MP4 DECOMPRESS ─────────────────────────────────────────────────────────

  async function decompressMP4(buffer) {
    const uint8 = new Uint8Array(buffer);
    const { origLen } = readHeader(uint8);
    const decompressed = decompressDeflate(uint8, origLen);

    return {
      data: decompressed.buffer,
      outputExt: '.mp4',
      outputMime: 'video/mp4',
      algorithm: 'DEFLATE inflate',
      verifiableOriginalSize: origLen,
      note: 'Container-level decompression. Codec-level compression (H.264) is irreversible.',
      isLossy: true,
    };
  }

  // ─── DISPATCHER ─────────────────────────────────────────────────────────────

  async function decompress(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const mime = file.type.toLowerCase();

    // Try to read as binary to check magic
    const buffer = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = e => res(e.target.result);
      reader.onerror = () => rej(new Error('Read failed'));
      reader.readAsArrayBuffer(file);
    });

    const uint8 = new Uint8Array(buffer);

    // Check our custom magic headers first
    if (matchesMagic(uint8, MAGIC.TXT)) {
      return decompressText(buffer);
    }

    if (matchesMagic(uint8, MAGIC.WAV)) {
      return decompressWAV(buffer);
    }

    if (matchesMagic(uint8, MAGIC.MP4)) {
      return decompressMP4(buffer);
    }

    // PNG: check standard PNG signature 89 50 4E 47
    if (uint8[0] === 0x89 && uint8[1] === 0x50 && uint8[2] === 0x4E && uint8[3] === 0x47) {
      return decompressPNG(file);
    }

    // JPEG: FF D8 FF
    if (uint8[0] === 0xFF && uint8[1] === 0xD8 && uint8[2] === 0xFF) {
      return decompressJPEG(file);
    }

    // Fallback: try DEFLATE anyway
    try {
      const result = await decompressText(buffer);
      return result;
    } catch {
      throw new Error('Unrecognised file format. Please use a file compressed by CompressKit.');
    }
  }

  return { decompress };
})();
