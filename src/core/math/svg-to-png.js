import sharp from 'sharp';

/**
 * Convert an SVG string to a high-resolution transparent PNG buffer.
 *
 * @param {string} svg - SVG source string
 * @param {object} options
 * @param {number} options.scale - Scale factor (default 3 for high-DPI)
 * @returns {Promise<{ pngBuffer: Buffer, width: number, height: number }>}
 */
export async function svgToPng(svg, { scale = 3 } = {}) {
  // Parse dimensions from SVG
  const widthMatch = svg.match(/width="([\d.]+)(?:ex|em|px)?"/);
  const heightMatch = svg.match(/height="([\d.]+)(?:ex|em|px)?"/);

  // MathJax uses 'ex' units; 1ex ≈ 8px at standard font size
  const exToPx = 8;
  let baseWidth = widthMatch ? parseFloat(widthMatch[1]) * exToPx : 200;
  let baseHeight = heightMatch ? parseFloat(heightMatch[1]) * exToPx : 50;

  const targetWidth = Math.ceil(baseWidth * scale);
  const targetHeight = Math.ceil(baseHeight * scale);

  if (targetWidth <= 0 || targetHeight <= 0 || isNaN(targetWidth) || isNaN(targetHeight)) {
    throw new Error(`Invalid SVG dimensions: ${targetWidth}x${targetHeight}`);
  }

  // Modify SVG to set explicit pixel dimensions for sharp
  let scaledSvg = svg;
  // Replace width/height with pixel values
  scaledSvg = scaledSvg.replace(/width="[\d.]+(?:ex|em|px)?"/, `width="${targetWidth}px"`);
  scaledSvg = scaledSvg.replace(/height="[\d.]+(?:ex|em|px)?"/, `height="${targetHeight}px"`);

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
