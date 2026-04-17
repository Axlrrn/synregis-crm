const fs = require('fs');
let c = fs.readFileSync('src/App.js', 'utf8');

// Add archive state after filterPriority state
c = c.replace(
  `var [filterPriority, setFilterPriority] = useState("All");`,
  `var [filterPriority, setFilterPriority] = useState("All");
  var [showArchive, setShowArchive] = useState(false);`
);

// Filter out Lost from main view, show only Lost in archive
c = c.replace(
  `var filtered = leads.filter(function(l) {
    var q = search.toLowerCase();
    var matchQ = !q || l.projectName.toLowerCase().includes(q) || l.promoteur.toLowerCase().includes(q) || (l.location||"").toLowerCase().includes(q);
    var matchP = filterPipeline === "All" || l.pipelineStage === filterPipeline;
    var matchR = filterPriority === "All"  || l.priority === filterPriority;
    return matchQ && matchP && matchR;
  });`,
  `var filtered = leads.filter(function(l) {
    var q = search.toLowerCase();
    var matchQ = !q || l.projectName.toLowerCase().includes(q) || l.promoteur.toLowerCase().includes(q) || (l.location||"").toLowerCase().includes(q);
    var matchP = filterPipeline === "All" || l.pipelineStage === filterPipeline;
    var matchR = filterPriority === "All"  || l.priority === filterPriority;
    if (showArchive) return l.pipelineStage === "Lost" && matchQ;
    return l.pipelineStage !== "Lost" && matchQ && matchP && matchR;
  });`
);

// Add archive toggle button next to the + Add button
c = c.replace(
  `<button onClick={function(){ setShowAdd(true); }}
                style={{ padding:"7px 12px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontWeight:700, fontSize:12, flexShrink:0 }}>
                + Add
              </button>`,
  `<button onClick={function(){ setShowAdd(true); }}
                style={{ padding:"7px 12px", borderRadius:6, border:"none", background:GOLD, color:NAVY, cursor:"pointer", fontWeight:700, fontSize:12, flexShrink:0 }}>
                + Add
              </button>
              <button onClick={function(){ setShowArchive(!showArchive); setSelected(null); }}
                style={{ padding:"7px 12px", borderRadius:6, border:"1px solid #ef444466", background:showArchive?"#ef4444":"transparent", color:showArchive?"#fff":"#ef4444", cursor:"pointer", fontSize:12, flexShrink:0 }}>
                {showArchive ? "← Pipeline" : "Lost"}
              </button>`
);

fs.writeFileSync('src/App.js', c);
console.log('Done! Archive: ' + (c.includes('showArchive') ? 'YES' : 'NO'));