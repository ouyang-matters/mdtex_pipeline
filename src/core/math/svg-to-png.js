import sharp from 'sharp';

/**
 * Convert an SVG string to a high-resolution transparent PNG buffer.
 *
 * @param {string} svg - SVG source string (may have ex or px dimensions)
 * @param {object} options
 * @param {number} options.scale - Scale factor (default 3 for high-DPI)
 * @returns {Promise<{ pngBuffer: Buffer, width: number, height: number }>}
 */
export async function svgToPng(svg, { scale = 3 } = {}) {
  const EX_TO_PX = 7;

  // Parse dimensions — may be px, ex, em, or unitless
  let baseWidth, baseHeight;

  const exWidth = svg.match(/width="([\d.]+)ex"/);
  const exHeight = svg.match(/height="([\d.]+)ex"/);
  const emWidth = svg.match(/width="([\d.]+)em"/);
  const emHeight = svg.match(/height="([\d.]+)em"/);
  const pxWidth = svg.match(/width="([\d.]+)(?:px)?"/);
  const pxHeight = svg.match(/height="([\d.]+)(?:px)?"/);

  if (exWidth) {
    baseWidth = parseFloat(exWidth[1]) * EX_TO_PX;
  } else if (emWidth) {
    baseWidth = parseFloat(emWidth[1]) * 16; // 1em ≈ 16px
  } else if (pxWidth) {
    baseWidth = parseFloat(pxWidth[1]);
  } else {
    baseWidth = 200;
  }

  if (exHeight) {
    baseHeight = parseFloat(exHeight[1]) * EX_TO_PX;
  } else if (emHeight) {
    baseHeight = parseFloat(emHeight[1]) * 16;
  } else if (pxHeight) {
    baseHeight = parseFloat(pxHeight[1]);
  } else {
    baseHeight = 50;
  }

  const targetWidth = Math.ceil(baseWidth * scale);
  const targetHeight = Math.ceil(baseHeight * scale);

  if (targetWidth <= 0 || targetHeight <= 0 || isNaN(targetWidth) || isNaN(targetHeight)) {
    throw new Error(`Invalid SVG dimensions: ${targetWidth}x${targetHeight}`);
  }

  // Replace dimensions with pixel values for sharp
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
