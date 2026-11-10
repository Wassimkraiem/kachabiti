// Builds input from the assembled graph, computes structural stats, and assigns layers by path rules.
const fs = require('fs');
const [graphPath, inPath, outPath, layersPath] = process.argv.slice(2);
const g = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const T = new Set(['file', 'config', 'document', 'service', 'pipeline', 'table', 'schema', 'resource', 'endpoint']);
const fileNodes = g.nodes.filter(x => T.has(x.type) && !(x.type === 'table' && x.id.split(':').length > 2))
  .map(({ id, type, name, filePath, summary, tags }) => ({ id, type, name, filePath: filePath || id.split(':')[1] || '', summary, tags }));
const ids = new Set(fileNodes.map(n => n.id));
const allEdges = g.edges.filter(e => ids.has(e.source) && ids.has(e.target));
const importEdges = allEdges.filter(e => e.type === 'imports');
fs.writeFileSync(inPath, JSON.stringify({ fileNodes, importEdges, allEdges }));

const grp = n => { const p = n.filePath.split('/'); if (p.length < 2) return 'root'; if (['app', 'api', 'components'].includes(p[0]) && p.length > 2) return p[0] + '/' + p[1]; return p[0]; };
const G = {}, byType = {}, fin = {}, fout = {}, inter = {}, intra = {}, gOf = {};
for (const n of fileNodes) { const k = grp(n); gOf[n.id] = k; (G[k] = G[k] || []).push(n.id); (byType[n.type] = byType[n.type] || []).push(n.id); }
for (const e of importEdges) {
  fout[e.source] = (fout[e.source] || 0) + 1; fin[e.target] = (fin[e.target] || 0) + 1;
  const a = gOf[e.source], b = gOf[e.target];
  intra[a] = intra[a] || { internalEdges: 0, totalEdges: 0 }; intra[b] = intra[b] || { internalEdges: 0, totalEdges: 0 };
  if (a === b) { intra[a].internalEdges++; intra[a].totalEdges++; } else { intra[a].totalEdges++; intra[b].totalEdges++; inter[a + '->' + b] = (inter[a + '->' + b] || 0) + 1; }
}
for (const k in intra) intra[k].density = +(intra[k].internalEdges / Math.max(1, intra[k].totalEdges)).toFixed(2);
const cc = {};
for (const e of allEdges) { const a = e.source.split(':')[0], b = e.target.split(':')[0]; if (a === 'file' && b === 'file') continue; const k = a + '|' + b + '|' + e.type; cc[k] = (cc[k] || 0) + 1; }
const interArr = Object.entries(inter).map(([k, c]) => { const [f, t] = k.split('->'); return { from: f, to: t, count: c }; }).sort((a, b) => b.count - a.count);
const dir = interArr.filter(({ from, to, count }) => count > (inter[to + '->' + from] || 0)).map(({ from, to }) => ({ dependent: from, dependsOn: to }));
const fp = fileNodes.map(n => n.filePath);
const res = {
  scriptCompleted: true, directoryGroups: G, nodeTypeGroups: byType,
  crossCategoryEdges: Object.entries(cc).map(([k, c]) => { const [f, t, e] = k.split('|'); return { fromType: f, toType: t, edgeType: e, count: c }; }),
  interGroupImports: interArr, intraGroupDensity: intra, dependencyDirection: dir,
  deploymentTopology: { hasDockerfile: fp.some(p => /Dockerfile/.test(p)), hasCompose: fp.some(p => /compose/.test(p)), hasK8s: false, hasTerraform: fp.some(p => /\.tf$/.test(p)), hasCI: fp.some(p => p.startsWith('.github/workflows')), infraFiles: fp.filter(p => /Dockerfile|compose|\.tf$|\.github\/workflows|^deploy\//.test(p)) },
  dataPipeline: { schemaFiles: fp.filter(p => /\.sql$/.test(p) && !/migrations/.test(p)), migrationFiles: fp.filter(p => /migrations\//.test(p)), dataModelFiles: fp.filter(p => p.startsWith('api/src/db/')), apiHandlerFiles: fp.filter(p => /controller\.ts$/.test(p)) },
  fileStats: { totalFileNodes: fileNodes.length, filesPerGroup: Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v.length])), nodeTypeCounts: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])) },
  fileFanIn: fin, fileFanOut: fout,
};
fs.writeFileSync(outPath, JSON.stringify(res, null, 1));

const rules = [
  ['documentation', n => n.type === 'document'],
  ['database', n => /^(supabase|db)\//.test(n.filePath) || ['table', 'schema'].includes(n.type)],
  ['test', n => /^api\/test\//.test(n.filePath)],
  ['infrastructure', n => ['service', 'resource', 'pipeline'].includes(n.type) || /^(infra|deploy|\.github)\//.test(n.filePath) || /^(\.dockerignore|vercel\.json|netlify\.toml|\.vercelignore|\.git-ssh-setup\.sh|\.gitattributes)$/.test(n.filePath)],
  ['scripts', n => /^(api\/)?scripts\//.test(n.filePath)],
  ['backend-api', n => /^api\/src\//.test(n.filePath)],
  ['admin-ui', n => /^(app\/admin|components\/admin)\//.test(n.filePath)],
  ['shared-lib', n => /^(lib|types|hooks)\//.test(n.filePath) || /^(middleware\.ts|instrumentation(-client)?\.ts|sentry\..*\.ts)$/.test(n.filePath) || /^app\/api\//.test(n.filePath)],
  ['config', n => n.type === 'config' || /^(eslint\.config\.mjs|next\.config\.ts|postcss\.config\.mjs|api\/eslint\.config\.mjs)$/.test(n.filePath)],
  ['storefront-ui', n => /^(app|components|public)\//.test(n.filePath) || /^app\//.test(n.filePath)],
];
const L = {}, miss = [];
for (const n of fileNodes) { const r = rules.find(([, f]) => f(n)); if (r) (L[r[0]] = L[r[0]] || []).push(n.id); else miss.push(n.id); }
const meta = {
  'storefront-ui': ['Storefront UI', 'Localized (en/fr/ar, RTL) Next.js App Router pages under app/[locale], the root app shell files, and the public storefront components (landing sections, layout, product UI) built with Tailwind.'],
  'admin-ui': ['Admin Back Office UI', 'Client-rendered Ant Design back office under app/admin and components/admin covering catalog, orders, stock, CRM, POS, purchasing, accounting and team screens.'],
  'shared-lib': ['Shared Logic & Middleware', 'Root lib/ helpers shared by the site and the NestJS API (as @shared/*), such as auth roles, API access rules, i18n, cart, catalog cache and ERP constants, plus the locale/auth middleware, Sentry instrumentation and the revalidate route.'],
  'backend-api': ['NestJS API', 'NestJS 11 app in api/src serving every /api request, organized by domain (auth, catalog, sales, stock, crm, finance, pos, purchasing, notifications) over Kysely/Postgres and S3 storage.'],
  'database': ['Database Schema', 'Postgres schema source of truth: supabase/migrations SQL defining tables, transactional functions and triggers for stock, activity log and accounting, plus the database baseline.'],
  'test': ['API E2E Tests', 'End-to-end suites in api/test that run against the local Docker stack and its database.'],
  'scripts': ['Scripts & Tooling', 'Operational Node scripts for WooCommerce and Colissimo imports, database moves, migrations, storage copy, and the local Docker and Colissimo stand-ins.'],
  'infrastructure': ['Infrastructure & Deployment', 'Dockerfiles and compose stacks, Terraform for the AWS EC2/S3 setup, server deploy and backup files, GitHub Actions CI/deploy workflows, and Vercel/Netlify hosting settings.'],
  'config': ['Project Configuration', 'Package manifests and TypeScript, ESLint, Next.js, PostCSS and NestJS CLI configuration for the site and the API.'],
  'documentation': ['Documentation', 'README files, the CLAUDE.md agent guide, and docs/ guides for Docker, deployment, Meta setup and the NestJS migration.'],
};
const out = Object.keys(meta).filter(k => L[k]).map(k => ({ id: 'layer:' + k, name: meta[k][0], description: meta[k][1], nodeIds: L[k] }));
const total = out.reduce((s, l) => s + l.nodeIds.length, 0);
if (miss.length || total !== fileNodes.length) { console.error('unassigned', miss, total, fileNodes.length); process.exit(1); }
fs.writeFileSync(layersPath, JSON.stringify(out, null, 2));
console.log(out.map(l => l.name + ': ' + l.nodeIds.length).join('\n'), '\ntotal', total);
console.log('storefront misc:', L['storefront-ui'].filter(i => !/^file:(app\/\[locale\]|components)/.test(i)).join(' '));
console.log('config:', L['config'].join(' '));
console.log('infra:', L['infrastructure'].join(' '));
