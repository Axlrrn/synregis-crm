const fs = require('fs');
let c = fs.readFileSync('src/App.js', 'utf8');

// Find the main layout div and make it responsive
c = c.replace(
  `display:"flex", flex:1, overflow:"hidden" }}>`,
  `display:"flex", flex:1, overflow:"hidden", position:"relative" }}>`
);

// Hide detail panel on mobile when nothing selected, show it fullscreen when selected
c = c.replace(
  `flex:1, display:"flex", flexDirection:"column", background:CARD, overflow:"hidden" }}>`,
  `flex:1, display:"flex", flexDirection:"column", background:CARD, overflow:"hidden", ...(selFull?{}:{display:"none"}), position:"absolute", inset:0, zIndex:100, overflowY:"auto" }}>`
);

fs.writeFileSync('src/App.js', c);
console.log('Done! Changes: ' + (c.includes('position:"absolute"') ? 'YES' : 'NO'));