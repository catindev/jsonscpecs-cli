const fs = require("fs");
const path = require("path");

function listEntrypoints(compiled, manifest) {
  const items = [];
  for (const [id, a] of compiled.registry) {
    if (a.type === "pipeline" && a.entrypoint === true) {
      const meta = manifest.entrypoints?.[id] || {};
      items.push({
        id,
        title: meta.title || a.description || id,
        description: meta.description || a.description || "",
        strict: Boolean(a.strict),
        requiredContext: Array.isArray(a.required_context)
          ? a.required_context
          : [],
      });
    }
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

function analyzePipeline(rootPipelineId, compiled) {
  const stats = {
    totalSteps: 0,
    rules: 0,
    conditions: 0,
    pipelines: 0,
    maxDepth: 0,
    librarySteps: 0,
    localSteps: 0,
    ruleIds: [],
    warnings: [],
  };
  const DEPTH_WARN = 5;
  const STEPS_WARN = 60;
  const LIBRARY_LOW = 50;
  function walk(steps, depth, visited) {
    if (!steps || !steps.length) return;
    if (depth > stats.maxDepth) stats.maxDepth = depth;
    for (const step of steps) {
      stats.totalSteps++;
      if (step.kind === "rule") {
        stats.rules++;
        stats.ruleIds.push(step.ruleId);
        if (step.ruleId?.startsWith("library.")) stats.librarySteps++;
        else stats.localSteps++;
      } else if (step.kind === "condition") {
        stats.conditions++;
        if (step.conditionId?.startsWith("library.")) stats.librarySteps++;
        else stats.localSteps++;
        const cmp = compiled.conditions?.get(step.conditionId);
        if (cmp && !visited.has(step.conditionId)) {
          visited.add(step.conditionId);
          walk(cmp.steps, depth + 1, visited);
        }
      } else if (step.kind === "pipeline") {
        stats.pipelines++;
        if (step.pipelineId?.startsWith("library.")) stats.librarySteps++;
        else stats.localSteps++;
        const cmp = compiled.pipelines?.get(step.pipelineId);
        if (cmp && !visited.has(step.pipelineId)) {
          visited.add(step.pipelineId);
          walk(cmp.steps, depth + 1, visited);
        }
      }
    }
  }
  const root = compiled.pipelines?.get(rootPipelineId);
  if (!root) return null;
  walk(root.steps, 1, new Set([rootPipelineId]));
  const ruleCount = {};
  for (const id of stats.ruleIds) ruleCount[id] = (ruleCount[id] || 0) + 1;
  const duplicates = Object.entries(ruleCount)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]);
  if (stats.maxDepth >= DEPTH_WARN)
    stats.warnings.push(
      `Глубина вложенности ${stats.maxDepth}. Рекомендуется не более ${DEPTH_WARN - 1}`,
    );
  if (stats.totalSteps >= STEPS_WARN)
    stats.warnings.push(
      `Всего шагов ${stats.totalSteps}. Сценарий может быть сложным для сопровождения`,
    );
  const libPct =
    stats.totalSteps > 0
      ? Math.round((stats.librarySteps / stats.totalSteps) * 100)
      : 0;
  if (libPct < LIBRARY_LOW && stats.totalSteps > 5)
    stats.warnings.push(
      `Только ${libPct}% шагов из библиотеки. Возможно стоит вынести правила в library`,
    );
  for (const [id, n] of duplicates)
    stats.warnings.push(
      `Правило ${id} встречается ${n} раза в дереве. Возможен дубль`,
    );
  return {
    totalSteps: stats.totalSteps,
    rules: stats.rules,
    conditions: stats.conditions,
    pipelines: stats.pipelines,
    maxDepth: stats.maxDepth,
    librarySteps: stats.librarySteps,
    localSteps: stats.localSteps,
    libraryPct: libPct,
    duplicates: duplicates.slice(0, 10),
    warnings: stats.warnings,
  };
}

function buildTree(rootPipelineId, compiled, manifest) {
  const nodes = [];
  const visited = new Set();
  function titleForArtifact(id) {
    const art = compiled.registry.get(id);
    const meta = manifest.artifacts?.[id] || {};
    return meta.title || art?.description || id;
  }
  function artifactLink(id) {
    return `/artifacts/${encodeURIComponent(id)}`;
  }
  function walkSteps(steps, out) {
    for (const step of steps || []) {
      if (step.kind === "rule") {
        const art = compiled.registry.get(step.ruleId);
        out.push({
          kind: "rule",
          id: step.ruleId,
          title: titleForArtifact(step.ruleId),
          subtitle: art?.operator
            ? `${art.operator}${art.field ? " · " + art.field : ""}`
            : "",
          link: artifactLink(step.ruleId),
          children: [],
        });
      } else if (step.kind === "condition") {
        const art = compiled.registry.get(step.conditionId);
        const cmp = compiled.conditions?.get(step.conditionId);
        const node = {
          kind: "condition",
          id: step.conditionId,
          title: titleForArtifact(step.conditionId),
          subtitle: art?.description || "",
          link: artifactLink(step.conditionId),
          children: [],
        };
        out.push(node);
        if (cmp && !visited.has(step.conditionId)) {
          visited.add(step.conditionId);
          walkSteps(cmp.steps, node.children);
        }
      } else if (step.kind === "pipeline") {
        const art = compiled.registry.get(step.pipelineId);
        const cmp = compiled.pipelines?.get(step.pipelineId);
        const node = {
          kind: "pipeline",
          id: step.pipelineId,
          title: titleForArtifact(step.pipelineId),
          subtitle: art?.strict ? "strict" : "",
          link: `/pipelines/${encodeURIComponent(step.pipelineId)}`,
          children: [],
        };
        out.push(node);
        if (cmp && !visited.has(step.pipelineId)) {
          visited.add(step.pipelineId);
          walkSteps(cmp.steps, node.children);
        }
      }
    }
  }
  const root = compiled.pipelines?.get(rootPipelineId);
  if (!root) return [];
  visited.add(rootPipelineId);
  walkSteps(root.steps, nodes);
  return nodes;
}

function generatePipelineDoc(rootPipelineId, compiled, manifest, fmt = "md") {
  const lines = [];
  const fields = manifest.fields || {};
  const operators = manifest.operators || {};
  const rootArt = compiled.registry.get(rootPipelineId);
  function mono(s) {
    return fmt === "wiki" ? `{{${s}}}` : `\`${s}\``;
  }
  function bold(s) {
    return fmt === "wiki" ? `*${s}*` : `**${s}**`;
  }
  function h(level, t) {
    return fmt === "wiki" ? `h${level}. ${t}` : `${"#".repeat(level)} ${t}`;
  }
  function hr() {
    return fmt === "wiki" ? "----" : "---";
  }
  function fieldLabel(id) {
    return fields[id]?.description || id;
  }
  function walkPipeline(id, depth, visited) {
    const art = compiled.registry.get(id);
    const cmp = compiled.pipelines?.get(id);
    lines.push(h(Math.min(6, depth + 2), art?.description || id));
    lines.push(`${bold("Сценарий")}: ${mono(id)}`);
    lines.push("");
    for (const step of cmp?.steps || []) {
      if (step.kind === "rule") {
        const rule = compiled.registry.get(step.ruleId);
        lines.push(
          `- ${bold(rule.description || step.ruleId)} (${mono(step.ruleId)})`,
        );
        if (rule.field)
          lines.push(
            `  - ${bold("Поле")}: ${fieldLabel(rule.field)} (${mono(rule.field)})`,
          );
        if (rule.operator)
          lines.push(
            `  - ${bold("Оператор")}: ${operators[rule.operator]?.description || rule.operator}`,
          );
        if (rule.message)
          lines.push(`  - ${bold("Сообщение")}: ${rule.message}`);
      } else if (step.kind === "condition") {
        const cond = compiled.registry.get(step.conditionId);
        lines.push(
          `- ${bold(cond.description || step.conditionId)} (${mono(step.conditionId)})`,
        );
        const ccmp = compiled.conditions?.get(step.conditionId);
        if (ccmp?.steps?.length && !visited.has(step.conditionId)) {
          visited.add(step.conditionId);
          for (const nested of ccmp.steps) {
            if (nested.kind === "rule") {
              const rule = compiled.registry.get(nested.ruleId);
              lines.push(
                `  - ${bold(rule.description || nested.ruleId)} (${mono(nested.ruleId)})`,
              );
            }
          }
        }
      } else if (step.kind === "pipeline") {
        if (!visited.has(step.pipelineId)) {
          visited.add(step.pipelineId);
          walkPipeline(step.pipelineId, depth + 1, visited);
        }
      }
    }
    lines.push("");
  }
  lines.push(h(1, rootArt?.description || rootPipelineId));
  lines.push(`${bold("Сценарий")}: ${mono(rootPipelineId)}`);
  lines.push(hr());
  lines.push("");
  walkPipeline(rootPipelineId, 1, new Set([rootPipelineId]));
  return lines.join("\n");
}

function generateArtifactDoc(id, compiled, manifest, fmt = "md") {
  const art = compiled.registry.get(id);
  if (!art) return "";
  const lines = [];
  function mono(s) {
    return fmt === "wiki" ? `{{${s}}}` : `\`${s}\``;
  }
  function bold(s) {
    return fmt === "wiki" ? `*${s}*` : `**${s}**`;
  }
  function h(level, t) {
    return fmt === "wiki" ? `h${level}. ${t}` : `${"#".repeat(level)} ${t}`;
  }
  const field = art.field ? manifest.fields?.[art.field] : null;
  lines.push(h(1, art.description || id));
  lines.push(`${bold("Артефакт")}: ${mono(id)}`);
  lines.push(`${bold("Тип")}: ${art.type}`);
  if (art.role) lines.push(`${bold("Роль")}: ${art.role}`);
  if (art.field)
    lines.push(
      `${bold("Поле")}: ${field?.description || art.field} (${mono(art.field)})`,
    );
  if (art.operator)
    lines.push(
      `${bold("Оператор")}: ${manifest.operators?.[art.operator]?.description || art.operator}`,
    );
  if (art.code) lines.push(`${bold("Код")}: ${art.code}`);
  if (art.message) lines.push(`${bold("Сообщение")}: ${art.message}`);
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(art, null, 2));
  lines.push("```");
  return lines.join("\n");
}

function loadSamples(samplesDir, pipelineId = null) {
  const items = [];
  if (!fs.existsSync(samplesDir)) return items;
  for (const f of fs.readdirSync(samplesDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const full = path.join(samplesDir, f);
      const raw = fs.readFileSync(full, "utf8");
      const body = JSON.parse(raw);
      if (!pipelineId || body?.context?.pipelineId === pipelineId) {
        items.push({ name: f.replace(/\.json$/, ""), file: f, body });
      }
    } catch (_) {}
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function analysisSummary(compiled, project, operatorMeta) {
  let ruleCount = 0,
    conditionCount = 0,
    pipelineCount = 0,
    dictionaryCount = 0,
    entrypointCount = 0;
  for (const [, art] of compiled.registry) {
    if (art.type === "rule") ruleCount++;
    else if (art.type === "condition") conditionCount++;
    else if (art.type === "pipeline") {
      pipelineCount++;
      if (art.entrypoint === true) entrypointCount++;
    } else if (art.type === "dictionary") dictionaryCount++;
  }
  return {
    artifactCount: compiled.registry.size,
    ruleCount,
    conditionCount,
    pipelineCount,
    dictionaryCount,
    entrypointCount,
    operatorPacks: Array.isArray(project.manifest.operatorPacks?.node)
      ? project.manifest.operatorPacks.node
      : [],
    operatorMeta: operatorMeta || {},
  };
}

function stepTitle(compiled, manifest, id) {
  const art = compiled.registry.get(id);
  const meta = manifest.artifacts?.[id] || manifest.entrypoints?.[id] || {};
  return meta.title || art?.description || id;
}

function buildFlowModel(pipelineId, compiled, manifest, visited = new Set()) {
  const cmp = compiled.pipelines?.get(pipelineId);
  if (!cmp) return [];
  return buildFlowSteps(cmp.steps || [], compiled, manifest, visited);
}

function buildFlowSteps(stepsInput, compiled, manifest, visited = new Set()) {
  const steps = [];
  for (const step of stepsInput || []) {
    if (step.kind === "rule") {
      const art = compiled.registry.get(step.ruleId);
      steps.push({
        kind: "rule",
        id: step.ruleId,
        title: stepTitle(compiled, manifest, step.ruleId),
        library: step.ruleId?.startsWith("library."),
        operator: art?.operator || "",
        field: art?.field || "",
      });
    } else if (step.kind === "pipeline") {
      const art = compiled.registry.get(step.pipelineId);
      const cyc = visited.has(step.pipelineId);
      const nextVisited = new Set(visited);
      nextVisited.add(step.pipelineId);
      steps.push({
        kind: "pipeline",
        id: step.pipelineId,
        title: stepTitle(compiled, manifest, step.pipelineId),
        library: step.pipelineId?.startsWith("library."),
        strict: Boolean(art?.strict),
        steps: cyc
          ? []
          : buildFlowModel(step.pipelineId, compiled, manifest, nextVisited),
      });
    } else if (step.kind === "condition") {
      const art = compiled.registry.get(step.conditionId);
      const ccmp = compiled.conditions?.get(step.conditionId);
      const nextVisited = new Set(visited);
      nextVisited.add(step.conditionId);
      const whenHtml = ccmp?.when
        ? require("./when-render").renderWhenTreeHtml(
            ccmp.when,
            (predId) => {
              const pred = compiled.registry.get(predId);
              const lbl = pred?.description || predId;
              return (
                '<a href="/rules/' +
                encodeURIComponent(predId) +
                '" class="flow-cond-rule-link">' +
                require("./when-render").escapeHtml(lbl) +
                "</a>"
              );
            },
            { className: "flow-cond-rules" },
          )
        : "";
      steps.push({
        kind: "condition",
        id: step.conditionId,
        title: stepTitle(compiled, manifest, step.conditionId),
        library: step.conditionId?.startsWith("library."),
        whenText: ccmp?.when
          ? require("./when-render").renderWhenText(
              ccmp.when,
              (predId) => {
                const pred = compiled.registry.get(predId);
                return pred?.description || predId;
              },
              { stripLeadingIf: true },
            )
          : "",
        whenHtml,
        steps: ccmp?.steps
          ? buildFlowSteps(ccmp.steps, compiled, manifest, nextVisited)
          : [],
      });
    }
  }
  return steps;
}

function enrichArtifactForUi(id, compiled, manifest) {
  const artifact = compiled.registry.get(id);
  if (!artifact) return null;
  const display = {
    artifact: manifest.artifacts?.[id] || null,
    field: artifact.field ? manifest.fields?.[artifact.field] || null : null,
    operator: artifact.operator
      ? manifest.operators?.[artifact.operator] || null
      : null,
    entrypoint: manifest.entrypoints?.[id] || null,
  };
  if (artifact.type === "condition") {
    const compiledCondition = compiled.conditions?.get(id) || null;
    return {
      artifact,
      compiled: compiledCondition
        ? {
            when: compiledCondition.when,
            whenText: compiledCondition.when
              ? require("./when-render").renderWhenText(
                  compiledCondition.when,
                  (predId) => {
                    const pred = compiled.registry.get(predId);
                    return pred?.description || predId;
                  },
                  { stripLeadingIf: true },
                )
              : "",
            whenHtml: compiledCondition.when
              ? require("./when-render").renderWhenTreeHtml(
                  compiledCondition.when,
                  (predId) => {
                    const pred = compiled.registry.get(predId);
                    const lbl = pred?.description || predId;
                    return (
                      '<a href="/rules/' +
                      encodeURIComponent(predId) +
                      '" class="flow-cond-rule-link">' +
                      require("./when-render").escapeHtml(lbl) +
                      "</a>"
                    );
                  },
                  { className: "flow-cond-rules" },
                )
              : "",
            steps: buildFlowSteps(
              compiledCondition.steps || [],
              compiled,
              manifest,
              new Set([id]),
            ),
          }
        : null,
      display,
    };
  }
  const compiledArtifact =
    artifact.type === "pipeline" ? compiled.pipelines?.get(id) : null;
  return { artifact, compiled: compiledArtifact || null, display };
}

module.exports = {
  listEntrypoints,
  analyzePipeline,
  buildTree,
  buildFlowModel,
  enrichArtifactForUi,
  generatePipelineDoc,
  generateArtifactDoc,
  loadSamples,
  analysisSummary,
};
