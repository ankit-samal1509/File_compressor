/**
 * metrics.js
 * Calculates compression metrics: ratio, savings, throughput.
 */

const MetricsEngine = (() => {
  /**
   * Format bytes to human-readable string.
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return val >= 10 ? `${val.toFixed(1)}${units[i]}` : `${val.toFixed(2)}${units[i]}`;
  }

  /**
   * Calculate compression metrics from original and compressed sizes.
   * @param {number} originalSize - bytes
   * @param {number} compressedSize - bytes
   * @returns {Object} metrics
   */
  function calculate(originalSize, compressedSize) {
    const ratio = originalSize / compressedSize;
    const savings = ((originalSize - compressedSize) / originalSize) * 100;
    const delta = originalSize - compressedSize;

    return {
      originalSize,
      compressedSize,
      ratio: ratio.toFixed(2) + ':1',
      ratioRaw: ratio,
      savings: savings.toFixed(1) + '%',
      savingsRaw: savings,
      delta,                             // bytes saved (can be negative)
      originalFormatted: formatBytes(originalSize),
      compressedFormatted: formatBytes(compressedSize),
      deltaFormatted: formatBytes(Math.abs(delta)),
    };
  }

  return { calculate, formatBytes };
})();
