export const licenseFrame = { left: 0.09, right: 0.91, top: 0.31, bottom: 0.69 };

interface CameraPixels {
  width: number;
  height: number;
  data: Uint8Array;
}

// Find a continuous contrast edge near each side of the guide.
export function hasFramedLicense({ width, height, data }: CameraPixels, previewRatio: number) {
  const imageRatio = width / height;
  const visibleWidth = Math.min(1, previewRatio / imageRatio);
  const visibleHeight = Math.min(1, imageRatio / previewRatio);
  const x = (fraction: number) => Math.round(width * ((1 - visibleWidth) / 2 + visibleWidth * fraction));
  const y = (fraction: number) => Math.round(height * ((1 - visibleHeight) / 2 + visibleHeight * fraction));

  const left = x(licenseFrame.left);
  const right = x(licenseFrame.right);
  const top = y(licenseFrame.top);
  const bottom = y(licenseFrame.bottom);
  const luminosity = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    return (data[index] * 3 + data[index + 1] * 6 + data[index + 2]) / 10;
  };

  function hasEdge(horizontal: boolean, center: number, start: number, end: number, margin: number) {
    const samples = 24;
    const limit = horizontal ? height : width;
    for (let edge = Math.max(3, center - margin); edge <= Math.min(limit - 4, center + margin); edge += 1) {
      let matches = 0;
      for (let index = 0; index < samples; index += 1) {
        const along = Math.round(start + (end - start) * (0.1 + 0.8 * index / (samples - 1)));
        const before = horizontal ? luminosity(along, edge - 3) : luminosity(edge - 3, along);
        const after = horizontal ? luminosity(along, edge + 3) : luminosity(edge + 3, along);
        if (Math.abs(before - after) >= 24) matches += 1;
      }
      if (matches >= 16) return true;
    }
    return false;
  }

  const horizontalMargin = Math.round((bottom - top) * 0.1);
  const verticalMargin = Math.round((right - left) * 0.07);
  return hasEdge(true, top, left, right, horizontalMargin)
    && hasEdge(true, bottom, left, right, horizontalMargin)
    && hasEdge(false, left, top, bottom, verticalMargin)
    && hasEdge(false, right, top, bottom, verticalMargin);
}
