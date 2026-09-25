import type { ImageItem } from '../src/project.ts';

/** Locally authored PNG: opaque grid, partial alpha, a soft fade, and a clear window. */
export function glassGrid(): ImageItem {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const colors = ['#11bfcf', '#ffaf38', '#bb39d2', '#f6f0d9'];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    ctx.fillStyle = colors[(x + y) % colors.length];
    ctx.fillRect(x * 64, y * 64, 64, 64);
    ctx.strokeStyle = '#152332'; ctx.lineWidth = 4; ctx.strokeRect(x * 64, y * 64, 64, 64);
  }
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, 512, 0);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.3, 'rgba(0,0,0,0.5)'); fade.addColorStop(0.6, '#000');
  ctx.fillStyle = fade; ctx.fillRect(0, 0, 512, 512);
  ctx.clearRect(352, 352, 64, 64);
  return { id: 'glass-grid', kind: 'image', imageData: canvas.toDataURL(), width: 0.46, x: 0, y: 0.1, offset: 0.025,
    alt: 'Colored grid: clear-to-opaque fade from left to right, and a transparent square near the bottom right' };
}
