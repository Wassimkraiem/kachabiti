const fs=require('fs');
try{
const {nodes,edges,layers}=JSON.parse(fs.readFileSync(process.argv[2]));
const ids=new Set(nodes.map(n=>n.id)),by=Object.fromEntries(nodes.map(n=>[n.id,n]));
const fin={},fout={},out={};nodes.forEach(n=>{fin[n.id]=new Set();fout[n.id]=new Set();out[n.id]=[]});
const E=edges.filter(e=>ids.has(e.source)&&ids.has(e.target)&&e.source!==e.target);
for(const e of E){fin[e.target].add(e.source);fout[e.source].add(e.target);if(e.type==='imports'||e.type==='calls')out[e.source].push(e.target)}
const rank=(m,k)=>nodes.map(n=>({id:n.id,[k]:m[n.id].size,name:n.name})).sort((a,b)=>b[k]-a[k]).slice(0,20);
const fo=nodes.map(n=>fout[n.id].size).sort((a,b)=>b-a),fi=nodes.map(n=>fin[n.id].size).sort((a,b)=>a-b);
const foT=fo[Math.floor(fo.length*0.1)]||0,fiB=fi[Math.floor(fi.length*0.25)]||0;
const EP=/^(index|main|app|server)\.(ts|js)$|^(mod|main)\.rs$|^main\.(go|py|cpp|c)$|^(manage|app|wsgi|asgi|run|__main__)\.py$|^(Application|Main)\.java$|^Program\.cs$|^config\.ru$|^index\.php$|^App\.swift$|^Application\.kt$/;
const cand=nodes.map(n=>{const fp=n.filePath||'',base=fp.split('/').pop(),depth=fp.split('/').length-1;let s=0;
 if(n.type==='document'){if(depth===0&&/^readme\.md$/i.test(base))s+=5;else if(depth===0&&/\.md$/i.test(base))s+=2}
 else if(n.type==='file'){if(EP.test(base))s+=3;if(depth<=1)s+=1;if(fout[n.id].size>=foT&&foT>0)s+=1;if(fin[n.id].size<=fiB)s+=1}
 return {id:n.id,score:s,name:n.name,summary:n.summary}}).filter(c=>c.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
const start=(cand.find(c=>by[c.id].type==='file')||{}).id;const order=[],depthMap={};
if(start){depthMap[start]=0;const q=[start];while(q.length){const c=q.shift();order.push(c);for(const t of out[c])if(!(t in depthMap)){depthMap[t]=depthMap[c]+1;q.push(t)}}}
const byDepth={};order.forEach(i=>(byDepth[depthMap[i]]??=[]).push(i));
const pick=ts=>nodes.filter(n=>ts.includes(n.type)).map(n=>({id:n.id,name:n.name,type:n.type,summary:n.summary}));
const has=(a,b)=>out[a].includes(b);const clusters=[],used=new Set();
for(const n of nodes)for(const t of out[n.id])if(n.id<t&&has(t,n.id)&&!used.has(n.id)&&!used.has(t)){const c=[n.id,t];
 for(const m of nodes){if(c.length>=5)break;if(c.includes(m.id))continue;const k=c.filter(x=>fout[m.id].has(x)||fin[m.id].has(x)).length;if(k>=2)c.push(m.id)}
 c.forEach(x=>used.add(x));const ec=E.filter(e=>c.includes(e.source)&&c.includes(e.target)).length;clusters.push({nodes:c,edgeCount:ec})}
clusters.sort((a,b)=>b.edgeCount-a.edgeCount);
fs.writeFileSync(process.argv[3],JSON.stringify({scriptCompleted:true,entryPointCandidates:cand,fanInRanking:rank(fin,'fanIn'),fanOutRanking:rank(fout,'fanOut'),
 bfsTraversal:{startNode:start,order,depthMap,byDepth},nonCodeFiles:{documentation:pick(['document']),infrastructure:pick(['service','pipeline','resource']),data:pick(['table','schema','endpoint']),config:pick(['config'])},
 clusters:clusters.slice(0,10),layers:{count:layers.length,list:layers},nodeSummaryIndex:Object.fromEntries(nodes.map(n=>[n.id,{name:n.name,type:n.type,summary:n.summary}])),totalNodes:nodes.length,totalEdges:E.length},null,1));
}catch(e){console.error(e);process.exit(1)}
