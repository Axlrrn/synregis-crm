const fs = require('fs');
let c = fs.readFileSync('src/App.js', 'utf8');
c = c.replace(
  `flex:1, display:"flex", flexDirection:"column", background:CARD, overflow:"hidden" }}>`,
  `flex:1, display:"flex", flexDirection:"column", background:CARD, overflow:"hidden", ...(window.innerWidth<640&&selFull?{position:"fixed",inset:0,zIndex:200,overflowY:"auto"}:{}) }}>`
);
fs.writeFileSync('src/App.js', c);
console.log('Done!');