const fs = require('fs');
let content = fs.readFileSync('src/screens/FieldsScreen.tsx', 'utf8');

const oldCode = `    if (mode === 'circle' && centre) {
      return Array.from({ length: 40 }, (_, i) => {
        const br = (i / 40) * 2 * Math.PI;
        const lat = centre[0] + (radius / R_EARTH) * (180 / Math.PI) * Math.cos(br);
        const lon = centre[1] + (radius / R_EARTH) * (180 / Math.PI) * Math.sin(br)
          / Math.cos(centre[0] * Math.PI / 180);
        return [lat, lon] as [number, number];
      });
    }`;

const newCode = `    if (mode === 'circle' && centre) {
      return Array.from({ length: 40 }, (_, i) => {
        // PostGIS geography requires COUNTER-CLOCKWISE outer rings.
        // We use -br so the points go North, West, South, East.
        const br = -(i / 40) * 2 * Math.PI;
        const lat = centre[0] + (radius / R_EARTH) * (180 / Math.PI) * Math.cos(br);
        const lon = centre[1] + (radius / R_EARTH) * (180 / Math.PI) * Math.sin(br)
          / Math.cos(centre[0] * Math.PI / 180);
        return [lat, lon] as [number, number];
      });
    }`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync('src/screens/FieldsScreen.tsx', content);
  console.log("Patched FieldsScreen.tsx successfully!");
} else {
  console.log("Could not find the old code in FieldsScreen.tsx");
}
