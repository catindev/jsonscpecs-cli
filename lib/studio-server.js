const express = require('express');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { createCliEngine, CompilationError } = require('./engine');
const { loadArtifactsFromDir } = require('./loader-fs');
const mountDocs = require('./docs-routes');
const { toStudioManifest } = require('./project');

function startStudio(project) {
  const runtime = createCliEngine(project);
  const ctx = Object.assign(new EventEmitter(), {
    compiled: null,
    rulesDir: project.rulesDir,
    samplesDir: project.samplesDir,
    manifest: toStudioManifest(project.manifest, runtime.operatorMeta)
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

  app.post('/v1/validate', (req, res) => {
    const body = req.body ?? {};
    if (!body.context || typeof body.context !== 'object') {
      return res.status(400).json({ error: true, message: 'Request body must contain "context" object' });
    }
    const pipelineId = body.context.pipelineId;
    if (!pipelineId || typeof pipelineId !== 'string') {
      return res.status(400).json({ error: true, message: 'context.pipelineId is required (string)' });
    }
    const payload = body.payload ?? {};
    const enrichedPayload = Object.assign({}, payload, { __context: body.context });
    try {
      const runtime = createCliEngine(project);
      const result = runtime.engine.runPipeline(ctx.compiled, pipelineId, enrichedPayload);
      const { trace, ...rest } = result;
      return res.json(Object.assign({ context: body.context }, rest));
    } catch (err) {
      return res.status(500).json({ error: true, message: err?.message || String(err), pipelineId });
    }
  });

  app.post('/v1/debug', (req, res) => {
    const body = req.body ?? {};
    if (!body.context || typeof body.context !== 'object') {
      return res.status(400).json({ error: true, message: 'Request body must contain "context" object' });
    }
    const pipelineId = body.context.pipelineId;
    if (!pipelineId || typeof pipelineId !== 'string') {
      return res.status(400).json({ error: true, message: 'context.pipelineId is required (string)' });
    }
    const payload = body.payload ?? {};
    const enrichedPayload = Object.assign({}, payload, { __context: body.context });
    try {
      const runtime = createCliEngine(project);
      const result = runtime.engine.runPipeline(ctx.compiled, pipelineId, enrichedPayload);
      return res.json(Object.assign({ context: body.context }, result));
    } catch (err) {
      return res.status(500).json({ error: true, message: err?.message || String(err), pipelineId });
    }
  });

  mountDocs(app, ctx);

  const port = Number(project.manifest.studio.port || 3100);
  const server = app.listen(port, () => {
    console.log(`[jsonspecs-cli] studio listening on http://localhost:${port}`);
  });
  return { app, server, ctx };
}

function compileIntoCtx(engine, operatorMeta, project, ctx, verbose = false) {
  const { artifacts, sources } = loadArtifactsFromDir(project.rulesDir);
  ctx.compiled = engine.compile(artifacts, { sources });
  ctx.manifest = toStudioManifest(project.manifest, operatorMeta);
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

  const watchRoots = [project.rulesDir, project.manifestPath, ...resolveLocalOperatorPackPaths(project)];
  for (const watchRoot of watchRoots) {
    const isDir = fs.existsSync(watchRoot) && fs.statSync(watchRoot).isDirectory();
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
