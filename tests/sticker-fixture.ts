/** Locally authored PNG fixtures; no network assets or uploads. */
export function stickerBitmap(kind: 'flower' | 'card' = 'flower') {
  const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400;
  const ctx = canvas.getContext('2d')!;
  if (kind === 'flower') {
    ctx.fillStyle = '#86daa8'; ctx.beginPath(); ctx.arc(200, 200, 166, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#155f50'; ctx.fillRect(192, 170, 16, 150);
    ctx.beginPath(); ctx.ellipse(162, 266, 48, 20, 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(238, 250, 48, 20, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f04d21'; ctx.beginPath(); ctx.arc(200, 145, 58, 0, Math.PI); ctx.fill();
    for (const x of [161, 200, 239]) { ctx.beginPath(); ctx.arc(x, 143, 20, Math.PI, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.fillStyle = '#bd227f'; ctx.fillRect(30, 30, 340, 340);
    ctx.fillStyle = '#40b4c7'; ctx.fillRect(30, 30, 160, 170);
    ctx.clearRect(80, 230, 80, 60);
    ctx.globalCompositeOperation = 'destination-in';
    const fade = ctx.createLinearGradient(200, 0, 370, 0);
    fade.addColorStop(0, '#000'); fade.addColorStop(1, 'transparent');
    ctx.fillStyle = fade; ctx.fillRect(0, 0, 400, 400);
  }
  return canvas.toDataURL();
}
