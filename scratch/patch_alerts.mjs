import fs from 'fs';

let content = fs.readFileSync('src/screens/AlertsScreen.tsx', 'utf-8');

// Imports
content = content.replace(
  `import { EmptyState } from '../components/EmptyState';`,
  `import { EmptyState } from '../components/EmptyState';\nimport { SwipeableList, SwipeableListItem, SwipeAction, TrailingActions, Type as ListType } from 'react-swipeable-list';\nimport 'react-swipeable-list/dist/styles.css';`
);

// Map additions
content = content.replace(
  `'fall': 'Fall Detected',`,
  `'fall': 'Fall Detected',\n    'steered_safe': 'Steered to Safety',`
);

// Icon mapping additions
content = content.replace(
  `if (kind === 'outside_zone' || kind === 'geofence_breach') return IconWarning;`,
  `if (kind === 'outside_zone' || kind === 'geofence_breach') return IconWarning;\n  if (kind === 'steered_safe') return IconCheck;`
);

// Add resolve function and modify rendering
const resolveFunc = `
  async function resolveAlert(id: string) {
    setRows((prev) => prev.map(r => r.id === id ? { ...r, resolved_at: new Date().toISOString() } : r));
    await supabase.from('alerts').update({ resolved_at: new Date().toISOString() }).eq('id', id);
  }

  const trailingActions = (id: string) => (
    <TrailingActions>
      <SwipeAction
        destructive={true}
        onClick={() => resolveAlert(id)}
      >
        <div style={{
          background: 'var(--green)', color: 'white', display: 'flex', alignItems: 'center', 
          justifyContent: 'center', padding: '0 20px', borderRadius: '14px', margin: '0 0 10px 10px',
          fontWeight: 600, fontSize: '0.9rem'
        }}>
          Dismiss
        </div>
      </SwipeAction>
    </TrailingActions>
  );
`;

content = content.replace(
  `const doneN = threads.filter((x) => x.row.resolved_at).length;`,
  `const doneN = threads.filter((x) => x.row.resolved_at).length;\n${resolveFunc}`
);

// Replace <ul> with <SwipeableList>
const ulTarget = `<ul className="grid gap-2.5 px-5">\n          {shown.map(({ row }, i) => {`;
const ulReplacement = `<div className="px-5">\n        <SwipeableList type={ListType.IOS} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>\n          {shown.map(({ row }, i) => {`;
content = content.replace(ulTarget, ulReplacement);

const liTarget = `<li key={row.id} className="rise" style={{ animationDelay: \`\${Math.min(i, 6) * 40}ms\` }}>`;
const liReplacement = `<div key={row.id} className="rise" style={{ animationDelay: \`\${Math.min(i, 6) * 40}ms\` }}>\n                <SwipeableListItem trailingActions={trailingActions(row.id)}>`;
content = content.replace(liTarget, liReplacement);

const liEndTarget = `</article>\n              </li>`;
const liEndReplacement = `</article>\n                </SwipeableListItem>\n              </div>`;
content = content.replace(liEndTarget, liEndReplacement);

const ulCloseTarget = `</ul>\n      )}`;
const ulCloseReplacement = `</SwipeableList>\n        </div>\n      )}`;
content = content.replace(ulCloseTarget, ulCloseReplacement);

// Fix toneOf for steered_safe
content = content.replace(
  `function toneOf(row: AlertRow): 'safe' | 'warn' | 'danger' {`,
  `function toneOf(row: AlertRow): 'safe' | 'warn' | 'danger' {\n  if (row.kind === 'steered_safe') return 'safe';`
);


fs.writeFileSync('src/screens/AlertsScreen.tsx', content);
console.log("Patched AlertsScreen.tsx");
