import { existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';

/**
 * ImageNode represents an image reference in the document.
 */
export class ImageNode {
  constructor(src, alt = '', title = '') {
    this.src = src;
    this.alt = alt;
    this.title = title;
    this.resolvedPath = null;
    this.isLocal = false;
    this.isRemote = false;
    this.needsUpload = false;
    this.exists = true;

    this._classify();
  }

  _classify() {
    if (/^https?:\/\//i.test(this.src)) {
      this.isRemote = true;
    } else if (/^data:/i.test(this.src)) {
      // data URI, inline
      this.isRemote = false;
      this.isLocal = false;
    } else {
      this.isLocal = true;
      this.needsUpload = true;
    }
  }

  /**
   * Resolve local image path relative to a base directory.
   */
  resolve(baseDir) {
    if (!this.isLocal) return this;

    const absPath = isAbsolute(this.src) ? this.src : resolve(baseDir, this.src);
    this.resolvedPath = absPath;
    this.exists = existsSync(absPath);
    return this;
  }
}

/**
 * Extract all images from rendered HTML.
 */
export function extractImages(html) {
  const images = [];
  const pattern = /<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*(?:title="([^"]*)")?[^>]*\/?>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    images.push(new ImageNode(match[1], match[2], match[3] || ''));
  }
  return images;
}

/**
 * Resolve all images in the list against a base directory.
 */
export function resolveImages(images, baseDir) {
  return images.map(img => img.resolve(baseDir));
}

/**
 * Uploader interface for Phase 2.
 * Implementations: WeChatImageUploader, S3Uploader, R2Uploader
 */
export class ImageUploader {
  async upload(imagePath) {
    throw new Error('ImageUploader.upload() not implemented');
  }

  async uploadAll(images) {
    const results = [];
    for (const img of images) {
      if (img.needsUpload && img.exists) {
        const url = await this.upload(img.resolvedPath);
        results.push({ image: img, url });
      }
    }
    return results;
  }
}
