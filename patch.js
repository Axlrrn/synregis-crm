const fs = require('fs');
let c = fs.readFileSync('src/App.js', 'utf8');

c = c.replace(
  `{selFull
            ? <DetailPanel lead={selFull} allLeads={leads} onEdit={startEdit} onCallLog={setCallLogLead} onSelect={function(r){ setSelected(r); }}/>
            : <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:MUTED, fontSize:14 }}>Select a project to view details</div>
          }`,
  `{selFull
            ? <div style={{display:"flex", flexDirection:"column", height:"100%"}}>
                <div style={{padding:"10px 16px", borderBottom:"1px solid "+BORDER, flexShrink:0}}>
                  <button onClick={function(){ setSelected(null); }} style={{padding:"6px 14px", borderRadius:6, border:"1px solid "+GOLD+"66", background:"transparent", color:GOLD, cursor:"pointer", fontSize:13}}>← Back</button>
                </div>
                <DetailPanel lead={selFull} allLeads={leads} onEdit={startEdit} onCallLog={setCallLogLead} onSelect={function(r){ setSelected(r); }}/>
              </div>
            : <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:MUTED, fontSize:14 }}>Select a project to view details</div>
          }`
);

fs.writeFileSync('src/App.js', c);
console.log('Done! Back button: ' + (c.includes('← Back') ? 'YES' : 'NO'));