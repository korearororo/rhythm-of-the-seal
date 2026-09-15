/* 생성 원본은 보존하고, 표시용 시트만 공통 픽셀·팔레트·기준선으로 만든다. */
const COMBAT_PALETTE = [
  '#151121', '#292038', '#443049', '#624557', '#866071',
  '#24324e', '#38496b', '#50698c', '#7395b5', '#a6c4d2', '#e1e5d8',
  '#382442', '#59345f', '#7f487b', '#a16c9c', '#cba4ce',
  '#4d362b', '#735035', '#a17144', '#c39862', '#ecc28d', '#f3dfb5',
  '#574829', '#8b6836', '#be944c', '#e1b95b', '#f5d981',
  '#283928', '#48502d', '#647239', '#8f9b4e', '#b9bb69',
  '#71362d', '#a84b34', '#d67448', '#eba06f',
  '#803c51', '#b55266', '#df7b7a', '#f2b4a0',
  '#47558d', '#6b7fbc', '#9aaedf', '#cfdef2'
].map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));

function prepareCombatArt(scene) {
  const layouts = scene.cache.json.get('combat-atlas-layout');
  const corrections = scene.cache.json.get('combat-row-corrections') || {};
  const audit = {};
  const colors = new Map();
  for (const [key, layout] of Object.entries(layouts)) {
    const source = scene.textures.get(key).getSourceImage();
    const viewport = corrections[key]?.viewport;
    const display = viewport?.display || (key.startsWith('seal-') ? 210 : key.startsWith('orc-') ? 178 : 164);
    const grid = Math.round(display / 1.25);
    const anchors = layout.frames[0].map(([x, , w]) => x + w / 2);
    const heights = layout.frames[0].map(frame => frame[3]).sort((a, b) => a - b);
    let left = 0, right = 0, maxHeight = 0;
    layout.frames.forEach(row => row.forEach(([x, , w, h], col) => {
      left = Math.min(left, x - anchors[col]);
      right = Math.max(right, x + w - anchors[col]);
      maxHeight = Math.max(maxHeight, h);
    }));
    if (viewport) for (const [row, correction] of Object.entries(corrections[key])) {
      if (row === 'viewport') continue;
      const ratio = heights[2] / correction.bodyHeight;
      correction.frames.forEach(([x, , w, h], col) => {
        left = Math.min(left, (x - correction.anchors[col]) * ratio + correction.baseOffset);
        right = Math.max(right, (x + w - correction.anchors[col]) * ratio + correction.baseOffset);
        maxHeight = Math.max(maxHeight, h * ratio);
      });
    }
    // 모든 동작에 같은 배율을 적용해 머리와 무기가 프레임마다 커지는 현상을 막는다.
    const scale = Math.min(grid * .67 / heights[2], grid * .84 / (right - left), grid * .8 / maxHeight);
    const anchor = (grid - (right - left) * scale) / 2 - left * scale;
    const packed = document.createElement('canvas');
    packed.width = 1120; packed.height = layout.rows * 280;
    const output = packed.getContext('2d'); output.imageSmoothingEnabled = false;
    const cell = document.createElement('canvas'); cell.width = cell.height = grid;
    const ctx = cell.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    const stats = [];
    layout.frames.forEach((row, rowIndex) => row.forEach(([x, y, w, h], col) => {
      const correction = corrections[key]?.[rowIndex];
      const rowSource = correction ? scene.textures.get(correction.texture).getSourceImage() : source;
      const rowScale = correction ? scale * heights[2] / correction.bodyHeight : scale;
      const rowAnchor = correction ? correction.anchors[col] : anchors[col];
      const outputAnchor = anchor + (correction?.baseOffset || 0) * scale;
      if (correction) [x, y, w, h] = correction.frames[col];
      ctx.clearRect(0, 0, grid, grid);
      ctx.drawImage(rowSource, x, y, w, h, Math.round(outputAnchor + (x - rowAnchor) * rowScale), Math.round(grid * .9 - h * rowScale), Math.round(w * rowScale), Math.round(h * rowScale));
      const image = ctx.getImageData(0, 0, grid, grid), pixels = image.data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 192) { pixels[i + 3] = 0; continue; }
        const code = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
        let rgb = colors.get(code);
        if (!rgb) {
          let best = Infinity;
          for (const candidate of COMBAT_PALETTE) {
            const d = candidate.reduce((sum, value, c) => sum + (value - pixels[i + c]) ** 2, 0);
            if (d < best) { best = d; rgb = candidate; }
          }
          colors.set(code, rgb);
        }
        pixels.set([...rgb, 255], i);
      }
      ctx.putImageData(image, 0, 0);
      output.drawImage(cell, col * 280, rowIndex * 280, 280, 280);
      stats.push({ row: rowIndex, col, grid, scale: rowScale, correction: correction?.source || null });
    }));
    scene.textures.remove(key);
    scene.textures.addCanvas(key, packed).setFilter(Phaser.Textures.FilterMode.NEAREST);
    audit[key] = { source: layout.generationSource, frames: stats, paletteSize: COMBAT_PALETTE.length, display, originX: viewport?.alignBody ? anchor / grid : .5 };
  }
  scene.registry.set('combatArtAudit', audit);
}

function combatFrames(key, row) {
  const resting = key.startsWith('kobold') ? [1, 2, 3, 2] : [0, 1, 3, 1];
  const restrainedHurt = row === 'hurt' && ['goblin', 'kobold', 'orc'].some(prefix => key.startsWith(prefix));
  const order = row === 'down' ? resting : row === 'guard' ? [0, 1] : restrainedHurt ? [0, 2, 3] : [0, 1, 2, 3];
  const holds = row === 'heavy' ? [200, 260, 100, 100] : row === 'attack' ? [100, 160, 120, 80] : row === 'hurt' ? [40, 150, 100, 40] : [];
  return order.map(col => ({ key, frame: `${row}-${col}`, duration: holds[col] || 0 }));
}
