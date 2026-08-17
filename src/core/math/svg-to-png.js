import sharp from 'sharp';

/**
 * Convert an SVG string to a high-resolution transparent PNG buffer.
 *
 * The SVG is expected to have pixel-based width/height attributes
 * (already converted from MathJax ex units by publish-renderer.js).
 *
 * @param {string} svg - SVG source string with pixel dimensions
 * @param {object} options
 * @param {number} options.scale - Scale factor (default 3 for high-DPI)
 * @returns {Promise<{ pngBuffer: Buffer, width: number, height: number }>}
 */
export async function svgToPng(svg, { scale = 3 } = {}) {
  // Parse pixel dimensions from SVG
  const widthMatch = svg.match(/width="([\d.]+)(?:px)?"/);
  const heightMatch = svg.match(/height="([\d.]+)(?:px)?"/);

  let baseWidth = widthMatch ? parseFloat(widthMatch[1]) : 200;
  let baseHeight = heightMatch ? parseFloat(heightMatch[1]) : 50;

  // If dimensions are still in ex units (legacy), convert
  if (svg.match(/width="[\d.]+ex"/)) {
    const exToPx = 7;
    baseWidth = parseFloat(svg.match(/width="([\d.]+)ex"/)[1]) * exToPx;
    baseHeight = parseFloat(svg.match(/height="([\d.]+)ex"/)?.[1] || '5') * exToPx;
  }

  const targetWidth = Math.ceil(baseWidth * scale);
  const targetHeight = Math.ceil(baseHeight * scale);

  if (targetWidth <= 0 || targetHeight <= 0 || isNaN(targetWidth) || isNaN(targetHeight)) {
    throw new Error(`Invalid SVG dimensions: ${targetWidth}x${targetHeight}`);
  }

  // Set pixel dimensions for sharp rendering
  let scaledSvg = svg;
  scaledSvg = scaledSvg.replace(/width="[\d.]+(?:ex|em|px)?"/, `width="${targetWidth}"`);
  scaledSvg = scaledSvg.replace(/height="[\d.]+(?:ex|em|px)?"/, `height="${targetHeight}"`);

  const pngBuffer = await sharp(Buffer.from(scaledSvg))
    .resize(targetWidth, targetHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { pngBuffer, width: targetWidth, height: targetHeight, scale };
}

/**
 * Convert SVG to a PNG data URI.
 */
export async function svgToPngDataUri(svg, options = {}) {
  const { pngBuffer, width, height, scale } = await svgToPng(svg, options);
  const dataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
  return { pngBuffer, pngDataUri: dataUri, width, height, scale };
}
