const express = require('express');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { createCliEngine, CompilationError } = require('./engine');
const { loadArtifactsFromDir } = require('./loader-fs');
const { toStudioManifest } = require('./project');
const { listEntrypoints, analyzePipeline, buildTree, buildFlowModel, enrichArtifactForUi, generatePipelineDoc, generateArtifactDoc, loadSamples, analysisSummary } = require('./studio-helpers');

function startStudio(project) {
  const runtime = createCliEngine(project);
  const ctx = Object.assign(new EventEmitter(), {
    compiled: null,
    rulesDir: project.rulesDir,
    samplesDir: project.samplesDir,
    manifest: toStudioManifest(project.manifest, runtime.operatorMeta),
    operatorMeta: runtime.operatorMeta,
    project
  });
  compileIntoCtx(runtime.engine, runtime.operatorMeta, project, ctx, true);
  startHotReload(project, ctx);

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  app.get('/health', (_req, res) => {
    if (!ctx.compiled || !ctx.compiled.registry) return res.status(503).json({ ok: false, reason: 'not ready' });
    res.json({ ok: true, mode: 'studio', projectId: project.manifest.project.id, projectTitle: project.manifest.project.title });
  });

  app.get('/api/project', (_req, res) => {
    res.json({
      projectId: project.manifest.project.id,
      projectTitle: project.manifest.project.title,
      projectDescription: project.manifest.project.description,
      runtime: 'node',
      manifest: ctx.manifest
    });
  });

  app.get('/api/entrypoints', (_req, res) => {
    res.json({ items: listEntrypoints(ctx.compiled, ctx.manifest) });
  });

  app.get('/api/analysis', (_req, res) => {
    res.json({ summary: analysisSummary(ctx.compiled, project, ctx.operatorMeta) });
  });

  app.get('/api/pipelines/:id', (req, res) => {
    const id = req.params.id;
    const pipeline = ctx.compiled.registry.get(id);
    if (!pipeline || pipeline.type !== 'pipeline') return res.status(404).json({ message: `Pipeline not found: ${id}` });
    const compiledPipeline = ctx.compiled.pipelines?.get(id) || null;
    const display = ctx.manifest.entrypoints?.[id] || ctx.manifest.artifacts?.[id] || {};
    const stats = analyzePipeline(id, ctx.compiled);
    res.json({ pipeline, compiled: compiledPipeline, display, stats });
  });

  app.get('/api/pipelines/:id/tree', (req, res) => {
    const id = req.params.id;
    const pipeline = ctx.compiled.registry.get(id);
    if (!pipeline || pipeline.type !== 'pipeline') return res.status(404).json({ message: `Pipeline not found: ${id}` });
    res.json({ pipelineId: id, nodes: buildTree(id, ctx.compiled, ctx.manifest) });
  });



  app.get('/api/pipelines/:id/flow', (req, res) => {
    const id = req.params.id;
    const pipeline = ctx.compiled.registry.get(id);
    if (!pipeline || pipeline.type !== 'pipeline') return res.status(404).json({ message: `Pipeline not found: ${id}` });
    res.json({ pipelineId: id, steps: buildFlowModel(id, ctx.compiled, ctx.manifest, new Set([id])) });
  });

  app.get('/api/rules/:id', (req, res) => {
    const id = req.params.id;
    const artifact = ctx.compiled.registry.get(id);
    if (!artifact || artifact.type !== 'rule') return res.status(404).json({ message: `Rule not found: ${id}` });
    res.json(enrichArtifactForUi(id, ctx.compiled, ctx.manifest));
  });

  app.get('/api/conditions/:id', (req, res) => {
    const id = req.params.id;
    const artifact = ctx.compiled.registry.get(id);
    if (!artifact || artifact.type !== 'condition') return res.status(404).json({ message: `Condition not found: ${id}` });
    res.json(enrichArtifactForUi(id, ctx.compiled, ctx.manifest));
  });

  app.get('/api/dictionaries/:id', (req, res) => {
    const id = req.params.id;
    const artifact = ctx.compiled.registry.get(id);
    if (!artifact || artifact.type !== 'dictionary') return res.status(404).json({ message: `Dictionary not found: ${id}` });
    res.json(enrichArtifactForUi(id, ctx.compiled, ctx.manifest));
  });

  app.get('/api/artifacts/:id', (req, res) => {
    const id = req.params.id;
    const artifact = ctx.compiled.registry.get(id);
    if (!artifact) return res.status(404).json({ message: `Artifact not found: ${id}` });
    res.json(enrichArtifactForUi(id, ctx.compiled, ctx.manifest));
  });

  app.get('/api/samples', (req, res) => {
    const pipelineId = req.query.pipelineId || null;
    res.json({ items: loadSamples(project.samplesDir, pipelineId) });
  });

  app.get('/api/docs/pipeline/:id', (req, res) => {
    const id = req.params.id;
    const pipeline = ctx.compiled.registry.get(id);
    if (!pipeline || pipeline.type !== 'pipeline') return res.status(404).json({ message: `Pipeline not found: ${id}` });
    const fmt = req.query.fmt === 'wiki' ? 'wiki' : 'md';
    res.json({ id, fmt, content: generatePipelineDoc(id, ctx.compiled, ctx.manifest, fmt) });
  });

  app.get('/api/docs/artifact/:id', (req, res) => {
    const id = req.params.id;
    const artifact = ctx.compiled.registry.get(id);
    if (!artifact) return res.status(404).json({ message: `Artifact not found: ${id}` });
    const fmt = req.query.fmt === 'wiki' ? 'wiki' : 'md';
    res.json({ id, fmt, content: generateArtifactDoc(id, ctx.compiled, ctx.manifest, fmt) });
  });

  app.post('/api/playground/run', (req, res) => {
    const body = req.body ?? {};
    if (!body.context || typeof body.context !== 'object') {
      return res.status(400).json({ message: 'Request body must contain "context" object' });
    }
    const pipelineId = body.context.pipelineId;
    if (!pipelineId || typeof pipelineId !== 'string') {
      return res.status(400).json({ message: 'context.pipelineId is required (string)' });
    }
    const payload = body.payload ?? {};
    const enrichedPayload = Object.assign({}, payload, { __context: body.context });
    try {
      const runtime = createCliEngine(project);
      const result = runtime.engine.runPipeline(ctx.compiled, pipelineId, enrichedPayload);
      return res.json(Object.assign({ context: body.context }, result));
    } catch (err) {
      return res.status(500).json({ message: err?.message || String(err), pipelineId });
    }
  });

  const staticDir = path.join(__dirname, '..', 'static');
  app.use(express.static(staticDir));
  app.get(/^\/(?!api\/|health$).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  const port = Number(project.manifest.studio.port || 3100);
  const server = app.listen(port, () => console.log(`[jsonspecs-cli] studio listening on http://localhost:${port}`));
  return { app, server, ctx };
}

function compileIntoCtx(engine, operatorMeta, project, ctx, verbose = false) {
  const { artifacts, sources } = loadArtifactsFromDir(project.rulesDir);
  ctx.compiled = engine.compile(artifacts, { sources });
  ctx.manifest = toStudioManifest(project.manifest, operatorMeta);
  ctx.operatorMeta = operatorMeta;
  if (verbose) console.log(`[studio] compiled ${artifacts.length} artifacts from ${project.rulesDir}`);
}

function startHotReload(project, ctx) {
  let debounceTimer = null;
  let lastFile = null;
  function reload(changedFile) {
    const rel = path.relative(project.root, changedFile);
    console.log(`\n[studio] changed: ${rel}`);
    console.log('[studio] recompiling...');
    try {
      delete require.cache[project.manifestPath];
      for (const spec of project.manifest.operatorPacks?.node || []) {
        if (spec.startsWith('.') || spec.startsWith('/')) {
          const resolved = path.resolve(project.root, spec);
          safeDeleteModuleCache(resolved);
        }
      }
      project.manifest = JSON.parse(fs.readFileSync(project.manifestPath, 'utf8'));
      const runtime = createCliEngine(project);
      compileIntoCtx(runtime.engine, runtime.operatorMeta, project, ctx);
      ctx.emit('reload');
      console.log('[studio] OK');
    } catch (err) {
      console.error('[studio] COMPILATION ERROR - keeping previous version');
      if (err instanceof CompilationError && Array.isArray(err.errors)) err.errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
      else console.error(`  ${err.message}`);
    }
  }
  const watchRoots = [project.rulesDir, project.manifestPath, ...resolveLocalOperatorPackPaths(project), project.samplesDir];
  for (const watchRoot of watchRoots) {
    if (!fs.existsSync(watchRoot)) continue;
    const isDir = fs.statSync(watchRoot).isDirectory();
    fs.watch(watchRoot, { recursive: isDir }, (event, filename) => {
      if (!filename && isDir) return;
      if (isDir && typeof filename === 'string' && filename.startsWith('.')) return;
      lastFile = isDir ? path.join(watchRoot, filename) : watchRoot;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => reload(lastFile), 150);
    });
  }
  console.log(`[studio] watching ${project.rulesDir}`);
}

function resolveLocalOperatorPackPaths(project) {
  const specs = Array.isArray(project.manifest.operatorPacks?.node) ? project.manifest.operatorPacks.node : [];
  return specs.filter((spec) => typeof spec === 'string' && (spec.startsWith('.') || spec.startsWith('/'))).map((spec) => path.resolve(project.root, spec));
}
function safeDeleteModuleCache(resolvedPath) {
  for (const key of Object.keys(require.cache)) {
    if (key === resolvedPath || key.startsWith(resolvedPath + path.sep)) delete require.cache[key];
  }
}
module.exports = { startStudio };
