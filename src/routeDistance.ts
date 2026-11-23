import type { Coordinates } from './api';

const metersPerDegree = 111195;

export function distanceToRoute(position: Coordinates, points: Coordinates[]) {
  const longitudeScale = metersPerDegree * Math.cos(position.latitude * Math.PI / 180);
  let nearest = Infinity;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const x = (start.longitude - position.longitude) * longitudeScale;
    const y = (start.latitude - position.latitude) * metersPerDegree;
    const dx = (end.longitude - start.longitude) * longitudeScale;
    const dy = (end.latitude - start.latitude) * metersPerDegree;
    const lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared ? Math.max(0, Math.min(1, -(x * dx + y * dy) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(x + fraction * dx, y + fraction * dy));
  }
  return nearest;
}
