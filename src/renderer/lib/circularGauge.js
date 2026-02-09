const SVG_NS = 'http://www.w3.org/2000/svg';

function clampPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function ensure(container) {
  if (container.__bdGauge) return container.__bdGauge;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'bd-gauge-svg');
  svg.setAttribute('viewBox', '0 0 58 58');

  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('class', 'bd-gauge-track');
  track.setAttribute('cx', '29');
  track.setAttribute('cy', '29');
  track.setAttribute('r', '24');
  track.setAttribute('fill', 'none');

  const prog = document.createElementNS(SVG_NS, 'circle');
  prog.setAttribute('class', 'bd-gauge-progress');
  prog.setAttribute('cx', '29');
  prog.setAttribute('cy', '29');
  prog.setAttribute('r', '24');
  prog.setAttribute('fill', 'none');

  svg.appendChild(track);
  svg.appendChild(prog);
  // Put SVG behind the number (which is positioned relative)
  container.prepend(svg);

  const r = 24;
  const circumference = 2 * Math.PI * r;
  prog.style.strokeDasharray = String(circumference);
  prog.style.transformOrigin = '50% 50%';
  prog.style.transform = 'rotate(-90deg)';

  container.__bdGauge = { svg, track, prog, circumference };
  return container.__bdGauge;
}

export function setCircularGauge(container, percent) {
  if (!container) return 0;
  const g = ensure(container);
  const p = clampPercent(percent);
  const offset = g.circumference * (1 - (p / 100));
  g.prog.style.strokeDashoffset = String(offset);
  return p;
}
