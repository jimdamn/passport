import { render } from 'qr-svg';

export function generateQrSvg(content: string): string {
  const { rects, size } = render(content, 'M');
  const quiet = 4;
  const cell = 10;
  const viewBoxSize = (size + quiet * 2) * cell;

  const svgRects = rects.map(r =>
    `<rect x="${(r.x + quiet) * cell}" y="${(r.y + quiet) * cell}" width="${r.width * cell}" height="${r.height * cell}"/>`
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" shape-rendering="crispEdges">
<rect width="${viewBoxSize}" height="${viewBoxSize}" fill="#ffffff"/>
<g fill="#1e3320">${svgRects.join('')}</g>
</svg>`;
}
