import fs from 'fs';

let content = fs.readFileSync('src/screens/FieldsScreen.tsx', 'utf-8');

const saveFunc = `  async function save() {
    if (ring.length < 3) return;
    setSaving(true);
    try {
      const { data: farmer } = await supabase.from('farmers').select('id').maybeSingle();
      if (!farmer) { setSaved('Sign in first — no farm profile found.'); return; }
      
      let sum = 0;
      for (let i = 0; i < ring.length; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % ring.length];
        sum += (p2[1] - p1[1]) * (p2[0] + p1[0]);
      }
      const isCw = sum > 0;
      let finalRing = [...ring];
      if (isCw) finalRing.reverse();

      const closed = [...finalRing, finalRing[0]];
      const wkt = \`SRID=4326;POLYGON((\${closed.map(([la, lo]) => \`\${lo} \${la}\`).join(',')}))\`;`;

const oldSaveFunc = `  async function save() {
    if (ring.length < 3) return;
    setSaving(true);
    try {
      const { data: farmer } = await supabase.from('farmers').select('id').maybeSingle();
      if (!farmer) { setSaved('Sign in first — no farm profile found.'); return; }
      const closed = [...ring, ring[0]];
      const wkt = \`SRID=4326;POLYGON((\${closed.map(([la, lo]) => \`\${lo} \${la}\`).join(',')}))\`;`;

if (content.includes(oldSaveFunc)) {
  content = content.replace(oldSaveFunc, saveFunc);
  fs.writeFileSync('src/screens/FieldsScreen.tsx', content);
  console.log("Patched FieldsScreen.tsx");
} else {
  console.log("Could not find old save func");
}
