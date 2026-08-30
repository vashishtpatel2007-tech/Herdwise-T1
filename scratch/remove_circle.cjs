const fs = require('fs');

let f = fs.readFileSync('src/screens/FieldsScreen.tsx', 'utf8');

// Remove remaining circle conditionals
f = f.replace(/.*mode === 'circle' && centre && \([\s\S]*?\n.*\}\)\n/g, '');
f = f.replace(/.*<Tool label="Circle"[\s\S]*?<\/Tool>\n/g, '');
f = f.replace(/.*\{mode === 'circle' && \([\s\S]*?<\/div>\n.*\}\)\n/g, '');

fs.writeFileSync('src/screens/FieldsScreen.tsx', f);
console.log("Updated FieldsScreen.tsx");
