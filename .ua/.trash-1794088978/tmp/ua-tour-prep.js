const fs=require('fs');const g=JSON.parse(fs.readFileSync(process.argv[2]));const L=JSON.parse(fs.readFileSync(process.argv[3]));
const T=new Set(['file','config','document','service','pipeline','table','schema','resource','endpoint']);
const nodes=g.nodes.filter(n=>T.has(n.type)&&(n.type!=='table'||n.id.startsWith('table:'))).map(n=>({id:n.id,name:n.name,filePath:n.filePath,summary:n.summary,type:n.type}));
const layers=(Array.isArray(L)?L:L.layers||[]).map(l=>({id:l.id,name:l.name,description:l.description}));
fs.writeFileSync(process.argv[4],JSON.stringify({nodes,edges:g.edges,layers}));console.log(nodes.length,g.edges.length,layers.length);
