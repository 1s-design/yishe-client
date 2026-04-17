import sharp from 'sharp';
import Delaunator from 'delaunator';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createSeededRandom(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function getPixel(data, width, x, y) {
  const px = clamp(Math.round(x), 0, width - 1);
  const py = clamp(Math.round(y), 0, Math.floor(data.length / 3 / width) - 1);
  const idx = (py * width + px) * 3;
  return [data[idx], data[idx + 1], data[idx + 2]];
}

function rgbToCss([r, g, b]) {
  return `rgb(${r},${g},${b})`;
}

function averageColors(colors) {
  if (!colors.length) return [0, 0, 0];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of colors) {
    r += c[0];
    g += c[1];
    b += c[2];
  }
  return [
    Math.round(r / colors.length),
    Math.round(g / colors.length),
    Math.round(b / colors.length),
  ];
}

function computeSobelMagnitude(gray, width, height) {
  const mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const a = gray[i - width - 1];
      const b = gray[i - width];
      const c = gray[i - width + 1];
      const d = gray[i - 1];
      const f = gray[i + 1];
      const g = gray[i + width - 1];
      const h = gray[i + width];
      const k = gray[i + width + 1];

      const gx = -a + c - 2 * d + 2 * f - g + k;
      const gy = -a - 2 * b - c + g + 2 * h + k;
      mag[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return mag;
}

function createPointGrid(width, height, minDistance) {
  const cellSize = Math.max(2, Math.floor(minDistance));
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cells = new Array(cols * rows).fill(null).map(() => []);
  return { cellSize, cols, rows, cells };
}

function canPlacePoint(grid, x, y, minDistance) {
  const gx = Math.floor(x / grid.cellSize);
  const gy = Math.floor(y / grid.cellSize);
  const minDist2 = minDistance * minDistance;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
      const bucket = grid.cells[ny * grid.cols + nx];
      for (const p of bucket) {
        const ddx = p[0] - x;
        const ddy = p[1] - y;
        if (ddx * ddx + ddy * ddy < minDist2) return false;
      }
    }
  }
  return true;
}

function addPointToGrid(grid, x, y) {
  const gx = Math.floor(x / grid.cellSize);
  const gy = Math.floor(y / grid.cellSize);
  const idx = gy * grid.cols + gx;
  if (idx >= 0 && idx < grid.cells.length) {
    grid.cells[idx].push([x, y]);
  }
}

export async function applyLowpoly(inputPath, outputPath, params = {}) {
  const pointCount = clamp(parseInt(params.pointCount, 10) || 900, 100, 6000);
  const edgeBias = clamp(Number(params.edgeBias ?? 0.65), 0, 1);
  const edgeThreshold = clamp(Number(params.edgeThreshold ?? 0.15), 0, 1);
  const strokeWidth = clamp(Number(params.strokeWidth ?? 0), 0, 8);
  const strokeColor = typeof params.strokeColor === 'string' ? params.strokeColor : '';
  const seed = parseInt(params.seed, 10) || 12345;
  const sampleScale = clamp(Number(params.sampleScale ?? 1), 0.2, 1);
  const colorSamples = clamp(parseInt(params.colorSamples, 10) || 7, 3, 16);
  const random = createSeededRandom(seed);

  const image = sharp(inputPath).removeAlpha();
  const metadata = await image.metadata();
  const sourceWidth = metadata.width || 1;
  const sourceHeight = metadata.height || 1;

  const scaledWidth = Math.max(1, Math.round(sourceWidth * sampleScale));
  const scaledHeight = Math.max(1, Math.round(sourceHeight * sampleScale));

  const { data } = await image
    .resize(scaledWidth, scaledHeight, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gray = new Float32Array(scaledWidth * scaledHeight);
  for (let i = 0, p = 0; i < gray.length; i++, p += 3) {
    gray[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  }

  const sobel = computeSobelMagnitude(gray, scaledWidth, scaledHeight);
  let maxMag = 0;
  for (let i = 0; i < sobel.length; i++) maxMag = Math.max(maxMag, sobel[i]);
  const threshold = maxMag * edgeThreshold;

  const points = [
    [0, 0],
    [scaledWidth - 1, 0],
    [scaledWidth - 1, scaledHeight - 1],
    [0, scaledHeight - 1],
    [Math.floor(scaledWidth / 2), 0],
    [scaledWidth - 1, Math.floor(scaledHeight / 2)],
    [Math.floor(scaledWidth / 2), scaledHeight - 1],
    [0, Math.floor(scaledHeight / 2)],
  ];

  const minDistance = Math.max(
    2,
    Math.sqrt((scaledWidth * scaledHeight) / Math.max(pointCount, 1)) * 0.6
  );
  const grid = createPointGrid(scaledWidth, scaledHeight, minDistance);
  for (const [x, y] of points) addPointToGrid(grid, x, y);

  const target = Math.max(pointCount, points.length);
  const maxAttempts = target * 40;
  let attempts = 0;
  while (points.length < target && attempts < maxAttempts) {
    attempts++;
    const x = Math.floor(random() * scaledWidth);
    const y = Math.floor(random() * scaledHeight);
    const idx = y * scaledWidth + x;
    const edge = maxMag > 0 ? sobel[idx] / maxMag : 0;
    const edgeScore = maxMag > 0 ? sobel[idx] / maxMag : 0;
    const edgeWeight = edgeBias * Math.pow(edgeScore, 0.85);
    const randomWeight = (1 - edgeBias) * 0.22;
    const acceptance = edgeWeight + randomWeight;
    const pass = (sobel[idx] >= threshold && random() < acceptance) || random() < randomWeight * 0.08;
    if (pass && canPlacePoint(grid, x, y, minDistance)) {
      points.push([x, y]);
      addPointToGrid(grid, x, y);
    }
  }

  let fallbackAttempts = 0;
  while (points.length < target && fallbackAttempts < target * 30) {
    fallbackAttempts++;
    const x = Math.floor(random() * scaledWidth);
    const y = Math.floor(random() * scaledHeight);
    if (!canPlacePoint(grid, x, y, minDistance * 0.7)) continue;
    points.push([x, y]);
    addPointToGrid(grid, x, y);
  }

  while (points.length < target) {
    const x = Math.floor(random() * scaledWidth);
    const y = Math.floor(random() * scaledHeight);
    points.push([x, y]);
  }

  const delaunay = Delaunator.from(points);
  const triangles = delaunay.triangles;
  const xScale = sourceWidth / scaledWidth;
  const yScale = sourceHeight / scaledHeight;

  const polygons = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const p1 = points[triangles[i]];
    const p2 = points[triangles[i + 1]];
    const p3 = points[triangles[i + 2]];
    if (!p1 || !p2 || !p3) continue;

    const centerX = (p1[0] + p2[0] + p3[0]) / 3;
    const centerY = (p1[1] + p2[1] + p3[1]) / 3;
    const colors = [getPixel(data, scaledWidth, centerX, centerY), getPixel(data, scaledWidth, p1[0], p1[1]), getPixel(data, scaledWidth, p2[0], p2[1]), getPixel(data, scaledWidth, p3[0], p3[1])];
    for (let s = 0; s < colorSamples - 4; s++) {
      const t1 = random();
      const t2 = random();
      const t3 = random();
      const sum = t1 + t2 + t3 || 1;
      const bx = (t1 * p1[0] + t2 * p2[0] + t3 * p3[0]) / sum;
      const by = (t1 * p1[1] + t2 * p2[1] + t3 * p3[1]) / sum;
      colors.push(getPixel(data, scaledWidth, bx, by));
    }
    const fill = rgbToCss(averageColors(colors));

    const ax = (p1[0] * xScale).toFixed(2);
    const ay = (p1[1] * yScale).toFixed(2);
    const bx = (p2[0] * xScale).toFixed(2);
    const by = (p2[1] * yScale).toFixed(2);
    const cxp = (p3[0] * xScale).toFixed(2);
    const cyp = (p3[1] * yScale).toFixed(2);

    const strokeAttrs = strokeWidth > 0
      ? ` stroke="${strokeColor || fill}" stroke-width="${strokeWidth}"`
      : '';
    polygons.push(`<polygon points="${ax},${ay} ${bx},${by} ${cxp},${cyp}" fill="${fill}"${strokeAttrs} />`);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}" viewBox="0 0 ${sourceWidth} ${sourceHeight}">${polygons.join('')}</svg>`;
  await sharp(Buffer.from(svg)).toFile(outputPath);

  return `lowpoly(pointCount=${target}, edgeBias=${edgeBias}, edgeThreshold=${edgeThreshold}, colorSamples=${colorSamples}, seed=${seed})`;
}
