function sortRadial(points) {
  if (points.length < 3) return points;
  let cx = 0, cy = 0;
  for (const [lat, lon] of points) { cx += lat; cy += lon; }
  cx /= points.length;
  cy /= points.length;

  return [...points].sort((a, b) => {
    const angleA = Math.atan2(a[1] - cy, a[0] - cx);
    const angleB = Math.atan2(b[1] - cy, b[0] - cx);
    return angleA - angleB;
  });
}

const bowtie = [[1,1], [1,-1], [-1,1], [-1,-1]];
console.log(sortRadial(bowtie));
