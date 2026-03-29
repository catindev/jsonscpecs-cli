/**
 * docs-routes.js
 *
 * Браузерная документация движка  только для dev-режима.
 * Шаблоны: views/*.ejs   Статика: static/
 *
 * Монтируется в server.js:
 *   if (IS_DEV) require('./docs-routes')(app, ctx);
 *
 * Маршруты:
 *   GET /                      список корневых пайплайнов
 *   GET /pipelines/:id(*)      страница пайплайна
 *   GET /rules/:id(*)          страница правила
 *   GET /conditions/:id(*)     страница условия
 *   GET /dictionaries/:id(*)   страница справочника
 *   GET /static/*              CSS, JS, иконки
 */

"use strict";

const path = require("path");
const fs = require("fs");
const ejs = require("ejs");
const express = require("express");
const { renderWhenText, renderWhenTreeHtml, escapeHtml, stripLeadingIf } = require("./when-render");

const VIEWS_DIR = path.join(__dirname, "..", "views");
const STATIC_DIR = path.join(__dirname, "..", "static");

// Иконки  загружаем один раз при старте
const ICON_NAMES = [
  "big-logotype",
  "big-pipline",
  "big-pipline-library",
  "big-rule",
  "big-rule-library",
  "big-condition",
  "big-condition-library",
  "big-dictionary",
  "pipeline-list-icon",
  "rule-list-icon",
  "condition-list-icon",
  "pipeline-list-icon-library",
  "rule-list-icon-library",
  "condition-list-icon-library",
  "predicate-list-icon",
  "check-icon",
  "check-icon-library",
  "predicate-icon",
  "predicate-icon-library",
  "level-icon",
  "level-icon-library",
  "field-icon",
  "field-icon-library",
  "operator-icon",
  "operator-icon-library",
  "value-icon",
  "value-icon-library",
  "dictionary-icon",
  "dictionary-icon-library",
];
const icons = {};
for (const name of ICON_NAMES) {
  const file = path.join(STATIC_DIR, "icons", name + ".svg");
  icons[name] = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function render(res, view, locals, manifest) {
  const file = path.join(VIEWS_DIR, view + ".ejs");
  ejs.renderFile(
    file,
    { ...locals, icons, manifest: manifest || {}, whenTools: { renderWhenText, renderWhenTreeHtml, escapeHtml } },
    { views: VIEWS_DIR },
    (err, html) => {
      if (err) {
        console.error("[docs] render error:", err.message);
        return res.status(500).send("<pre>" + err.message + "</pre>");
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    },
  );
}

// ── Анализ метрик пайплайна ───────────────────────────────────────────────
function analyzePipeline(rootPipelineId, compiled) {
  const stats = {
    totalSteps: 0, // все шаги во всём дереве
    rules: 0, // шагов-правил
    conditions: 0, // шагов-условий
    pipelines: 0, // шагов-пайплайнов
    maxDepth: 0, // максимальная глубина вложенности
    librarySteps: 0, // шаги из library.*
    localSteps: 0, // локальные шаги
    ruleIds: [], // все ruleId в дереве (с повторами)
    warnings: [], // предупреждения
  };

  const DEPTH_WARN = 5;
  const STEPS_WARN = 60;
  const LIBRARY_LOW = 50; // %  ниже которого предупреждаем

  // Рекурсивный обход
  function walk(steps, depth, visited) {
    if (!steps || !steps.length) return;
    if (depth > stats.maxDepth) stats.maxDepth = depth;

    for (const step of steps) {
      stats.totalSteps++;

      if (step.kind === "rule") {
        stats.rules++;
        stats.ruleIds.push(step.ruleId);
        if (step.ruleId && step.ruleId.startsWith("library."))
          stats.librarySteps++;
        else stats.localSteps++;
      } else if (step.kind === "condition") {
        stats.conditions++;
        const isLib =
          step.conditionId && step.conditionId.startsWith("library.");
        if (isLib) stats.librarySteps++;
        else stats.localSteps++;

        // Обходим шаги внутри condition
        const cmp =
          compiled.conditions && compiled.conditions.get(step.conditionId);
        if (cmp && !visited.has(step.conditionId)) {
          visited.add(step.conditionId);
          walk(cmp.steps, depth + 1, visited);
        }
      } else if (step.kind === "pipeline") {
        stats.pipelines++;
        const isLib = step.pipelineId && step.pipelineId.startsWith("library.");
        if (isLib) stats.librarySteps++;
        else stats.localSteps++;

        const cmp =
          compiled.pipelines && compiled.pipelines.get(step.pipelineId);
        if (cmp && !visited.has(step.pipelineId)) {
          visited.add(step.pipelineId);
          walk(cmp.steps, depth + 1, visited);
        }
      }
    }
  }

  const root = compiled.pipelines && compiled.pipelines.get(rootPipelineId);
  if (!root) return null;

  walk(root.steps, 1, new Set([rootPipelineId]));

  // Дубли правил
  const ruleCount = {};
  for (const id of stats.ruleIds) ruleCount[id] = (ruleCount[id] || 0) + 1;
  const duplicates = Object.entries(ruleCount)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]);

  // Предупреждения
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

// ── Генерация документации пайплайна в Markdown ──────────────────────────

// ── Генератор документации пайплайна ─────────────────────────────────────
// fmt: 'md' | 'wiki'

function generatePipelineDoc(rootPipelineId, compiled, manifest, fmt) {
  fmt = fmt || "md";
  const isMd = fmt === "md";

  const registry = compiled.registry;
  const pipelines = compiled.pipelines;
  const conditions = compiled.conditions;
  const operators = (manifest && manifest.operators) || {};
  const fields = (manifest && manifest.fields) || {};

  // ── Форматирование ──────────────────────────────────────────────────────

  function bold(s) {
    return isMd ? `**${s}**` : `*${s}*`;
  }
  function mono(s) {
    return isMd ? `\`${s}\`` : `{{${s}}}`;
  }
  function italic(s) {
    return isMd ? `_${s}_` : `_${s}_`;
  }
  function quote(s) {
    return isMd ? `> ${s}` : `{quote}${s}{quote}`;
  }
  function hr() {
    return isMd ? "---" : "----";
  }
  function h(level, text) {
    if (isMd) return "#".repeat(level) + " " + text;
    return "h" + level + ". " + text;
  }
  function label(key, val) {
    return isMd ? `**${key}:** ${val}` : `*${key}:* ${val}`;
  }

  // ── Поля и операторы ────────────────────────────────────────────────────

  function fieldLabel(fieldId) {
    if (!fieldId) return "";
    const f = fields[fieldId];
    return f && f.description ? f.description : fieldId;
  }

  function prettyFieldId(fieldId) {
    if (!fieldId) return "";
    return String(fieldId).replace(/([A-Za-z_][A-Za-z0-9_]*?)(\d+)(?=\.|$)/g, (_, base, idx) => `${base}[${idx}]`);
  }

  // Строчная первая буква
  function lc(s) {
    if (!s) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  // Подставляем шаблон оператора
  // Первичные поля  bold, вторичные (в скобках)  mono
  function applyTemplate(rule, role) {
    const op = operators[rule.operator];
    const tpl = op
      ? role === "predicate"
        ? op.predicate_template || op.check_template || op.description
        : op.check_template || op.description
      : null;

    if (!tpl) return rule.description || rule.operator;

    let r = tpl;

    // any_filled  поля вторичны, выводим отдельной строкой
    if (rule.fields && Array.isArray(rule.fields)) {
      const humanList = rule.fields
        .map((f) => {
          const fd = fields[f];
          const d = fd && fd.description ? fd.description : f;
          return d === f ? bold(prettyFieldId(f)) : `${italic(lc(d))} (${bold(prettyFieldId(f))})`;
        })
        .join(", ");
      r = r.replace("{fields}", humanList);
      return r;
    }

    // field_*_field  оба поля вторичны
    if (rule.value_field) {
      const fDesc = fieldLabel(rule.field);
      const vDesc = fieldLabel(rule.value_field);
      const fStr =
        fDesc === rule.field
          ? bold(prettyFieldId(rule.field))
          : `${italic(lc(fDesc))} (${bold(prettyFieldId(rule.field))})`;
      const vStr =
        vDesc === rule.value_field
          ? bold(prettyFieldId(rule.value_field))
          : `${italic(lc(vDesc))} (${bold(prettyFieldId(rule.value_field))})`;
      r = r.replace("{field}", fStr);
      r = r.replace("{value_field}", vStr);
      return [
        r,
        `Сравниваются поля ${bold(prettyFieldId(rule.field))} и ${bold(prettyFieldId(rule.value_field))}.`,
      ].join("\n");
    }

    // Одно поле  первичное если нет описания, вторичное если есть
    if (rule.field) {
      const desc = fieldLabel(rule.field);
      const isPrimary = desc === rule.field; // нет описания в манифесте
      const fieldStr = isPrimary
        ? bold(prettyFieldId(rule.field))
        : `${italic(lc(desc))} (${bold(prettyFieldId(rule.field))})`;
      r = r.replace("{field}", fieldStr);
    }

    if (rule.value !== undefined) {
      const v =
        typeof rule.value === "string" ? bold(rule.value) : String(rule.value);
      r = r.replace("{value}", v);
    }

    return r;
  }

  // ── Строгость ───────────────────────────────────────────────────────────

  const CONSEQUENCE = {
    EXCEPTION:
      "дальнейшие проверки прекращаются и ошибка возвращается как окончательная.",
    ERROR: "возвращается ошибка. Дальнейшие проверки продолжаются.",
    WARNING: "возвращается предупреждение. Дальнейшие проверки продолжаются.",
  };

  // ── Рендер правила ──────────────────────────────────────────────────────

  const lines = [];
  const visited = new Set();
  // Глобальный счётчик для нумерации разделов
  const counter = [0]; // [top-level]

  function push(...args) {
    args.forEach((a) => lines.push(a));
  }

  function renderWhenOutline(expr, leafRenderer) {
    if (!expr) return [];

    function introFor(mode, nested) {
      if (nested) {
        return mode === "any"
          ? "выполнено одно из этих условий:"
          : "выполнены все эти условия:";
      }
      return mode === "any"
        ? "Если выполнено одно из этих условий:"
        : "Если выполнены все эти условия:";
    }

    function leafText(node) {
      const raw = leafRenderer(node.predId || node.pred || node.ref || "");
      return stripLeadingIf(raw);
    }

    function renderMdNode(node, depth, numberPrefix) {
      const indent = "   ".repeat(depth);
      if (node.mode === "single") {
        return [`${indent}${numberPrefix}. ${leafText(node)}`];
      }

      const items = node.items || [];
      if (depth === 0 && items.length === 1) {
        return renderMdNode(items[0], depth, numberPrefix || 1);
      }

      const out = [];
      if (numberPrefix == null) {
        out.push(introFor(node.mode, false), "");
      } else {
        out.push(`${indent}${numberPrefix}. ${introFor(node.mode, true)}`);
      }

      items.forEach((item, index) => {
        out.push(...renderMdNode(item, depth + 1, index + 1));
      });
      return out;
    }

    function renderWikiNode(node, depth, numberPrefix) {
      if (node.mode === "single") {
        const bullet = "#".repeat(Math.max(1, depth));
        return [`${bullet} ${numberPrefix}. ${leafText(node)}`];
      }

      const items = node.items || [];
      if (depth === 0 && items.length === 1) {
        return renderWikiNode(items[0], 1, numberPrefix || 1);
      }

      const bullet = "#".repeat(Math.max(1, depth || 1));
      const out = [];
      if (numberPrefix == null) {
        out.push(introFor(node.mode, false), "");
      } else {
        out.push(`${bullet} ${numberPrefix}. ${introFor(node.mode, true)}`);
      }
      items.forEach((item, index) => {
        out.push(...renderWikiNode(item, depth + 1, index + 1));
      });
      return out;
    }

    return isMd ? renderMdNode(expr, 0, null) : renderWikiNode(expr, 0, null);
  }

  function renderRule(rule, num) {
    const title = rule.description || rule.id;
    push(h(Math.min(num.length + 1, 4), `${num.join(".")}. ${title}`), "");

    // Условие проверки
    const phrase = applyTemplate(rule, "check");
    const phraseLines = phrase.split("\n");
    phraseLines.forEach((l) => push(quote(l)));
    push("");

    // Строгость
    const cons = CONSEQUENCE[rule.level] || "";
    if (cons)
      push(label("Строгость", `если проверка не выполнена, то ${cons}`), "");

    // Сообщение
    if (rule.message) push(label("Сообщение", rule.message), "");

    // Код
    if (rule.code) push(label("Код", rule.code), "");

    push(hr(), "");
  }

  // ── Обход дерева ────────────────────────────────────────────────────────

  function walkPipeline(pipelineId, num) {
    if (visited.has(pipelineId)) return;
    visited.add(pipelineId);

    const art = registry.get(pipelineId);
    const cmp = pipelines && pipelines.get(pipelineId);
    if (!cmp) return;

    const title = art && art.description ? art.description : pipelineId;

    // Уровень заголовка: корень=1, первый уровень вложенности=2, глубже=3 max
    const hLevel = Math.min(num.length + 1, 4);
    push("", h(hLevel, num.length ? `${num.join(".")}. ${title}` : title), "");

    walkSteps(cmp.steps, num);
  }

  function walkSteps(steps, parentNum) {
    if (!steps || !steps.length) return;

    // Счётчик внутри текущего уровня
    let idx = 0;

    for (const step of steps) {
      if (step.kind === "rule") {
        const rule = registry.get(step.ruleId);
        if (!rule || rule.role === "predicate") continue;

        idx++;
        const num = [...parentNum, idx];
        renderRule(rule, num);
      } else if (step.kind === "condition") {
        const cid = step.conditionId;
        const cart = registry.get(cid);
        const ccmp = conditions && conditions.get(cid);
        if (!ccmp) continue;

        const whenLines = renderWhenOutline(
          ccmp.when,
          (predId) => {
            const pred = registry.get(predId);
            return pred ? applyTemplate(pred, "predicate") : predId;
          },
        );

        // Условный блок  не увеличивает счётчик, но создаёт заголовок если есть description
        const condTitle = cart && cart.description ? cart.description : null;
        if (condTitle) {
          idx++;
          const num = [...parentNum, idx];
          push(
            "",
            h(Math.min(num.length + 1, 4), `${num.join(".")}. ${condTitle}`),
            "",
          );
          whenLines.forEach((line) => push(line));
          if (ccmp.steps && ccmp.steps.length) {
            push("", isMd ? "то далее выполняются следующие вложенные проверки:" : "то далее выполняются следующие вложенные проверки:", "");
          } else {
            push("");
          }
          walkSteps(ccmp.steps, num);
        } else {
          whenLines.forEach((line) => push(line));
          if (ccmp.steps && ccmp.steps.length) {
            push("", isMd ? "то далее выполняются следующие вложенные проверки:" : "то далее выполняются следующие вложенные проверки:", "");
          } else {
            push("");
          }
          walkSteps(ccmp.steps, parentNum);
        }
      } else if (step.kind === "pipeline") {
        idx++;
        const num = [...parentNum, idx];
        walkPipeline(step.pipelineId, num);
      }
    }
  }

  // ── Корень ──────────────────────────────────────────────────────────────

  const rootArt = registry.get(rootPipelineId);
  const rootTitle =
    rootArt && rootArt.description ? rootArt.description : rootPipelineId;

  push(h(1, rootTitle), "");
  push(label("Сценарий", mono(rootPipelineId)), "");
  push(hr(), "");

  const rootCmp = pipelines && pipelines.get(rootPipelineId);
  if (rootCmp) {
    visited.add(rootPipelineId);
    walkSteps(rootCmp.steps, []);
  }

  return lines.join("\n");
}

module.exports = function mountDocs(app, ctx) {
  const rulesDir = ctx.rulesDir;
  let manifest = ctx.manifest || {};
  console.log(
    "[docs] manifest:",
    manifest.name ? `loaded "${manifest.name}"` : "not found (using empty)",
  );

  if (ctx.on) {
    ctx.on("reload", () => {
      manifest = ctx.manifest || manifest;
    });
  }

  app.use("/static", express.static(STATIC_DIR));

  // Главная  только корневые пайплайны (id без точки)
  app.get("/", (req, res) => {
    const pipelines = [];
    for (const [id, a] of ctx.compiled.registry) {
      if (a.type === "pipeline" && a.entrypoint === true) pipelines.push(a);
    }
    pipelines.sort((a, b) => a.id.localeCompare(b.id));
    render(res, "home", { pipelines }, manifest);
  });

  // Пайплайн
  app.get("/pipelines/:id", (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== "pipeline")
      return res.status(404).send("Pipeline not found: " + req.params.id);
    const cmp = ctx.compiled.pipelines && ctx.compiled.pipelines.get(a.id);
    const steps = cmp ? cmp.steps : [];
    render(
      res,
      "pipeline",
      { pipeline: a, steps, compiled: ctx.compiled },
      manifest,
    );
  });

  // Статистика пайплайна
  app.get("/pipelines/:id/stats", (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== "pipeline")
      return res.status(404).send("Pipeline not found: " + req.params.id);
    const result = analyzePipeline(a.id, ctx.compiled);
    if (!result) return res.status(500).send("Failed to analyze pipeline");
    render(res, "stats", { pipeline: a, stats: result }, manifest);
  });

  // Документация пайплайна
  app.get("/pipelines/:id/doc", (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== "pipeline")
      return res.status(404).send("Pipeline not found: " + req.params.id);
    const fmt = req.query.fmt === "wiki" ? "wiki" : "md";
    const content = generatePipelineDoc(a.id, ctx.compiled, manifest, fmt);
    render(res, "doc", { pipeline: a, docContent: content, fmt }, manifest);
  });

  // Playground  тест пайплайна
  app.get("/pipelines/:id/playground", (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== "pipeline")
      return res.status(404).send("Pipeline not found: " + req.params.id);
    const payloadsDir = ctx.samplesDir || path.join(rulesDir, '..', 'samples');
    const examples = [];
    if (fs.existsSync(payloadsDir)) {
      for (const f of fs.readdirSync(payloadsDir)) {
        if (!f.endsWith(".json")) continue;
        try {
          const raw = fs.readFileSync(path.join(payloadsDir, f), "utf8");
          const obj = JSON.parse(raw);
          if (obj.context && obj.context.pipelineId === a.id)
            examples.push({ name: f.replace(".json", ""), body: raw });
        } catch (e) {
          /* skip */
        }
      }
    }
    // Собираем краткий registry для трейса: ruleId -> {field, operator, role, description}
    const traceRegistry = {};
    for (const [id, art] of ctx.compiled.registry) {
      if (art.type === "rule") {
        traceRegistry[id] = {
          description: art.description || "",
          role: art.role || "",
          field: art.field || "",
          operator: art.operator || "",
          value: art.value !== undefined ? JSON.stringify(art.value) : "",
        };
      }
    }
    render(
      res,
      "playground",
      { pipeline: a, examples, traceRegistry: JSON.stringify(traceRegistry) },
      manifest,
    );
  });

  // Правило
  app.get("/rules/:id", (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== "rule")
      return res.status(404).send("Rule not found: " + req.params.id);
    render(res, "rule", { rule: a }, manifest);
  });

  // Условие
  app.get("/conditions/:id", (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== "condition")
      return res.status(404).send("Condition not found: " + req.params.id);
    render(
      res,
      "condition",
      { condition: a, compiled: ctx.compiled },
      manifest,
    );
  });

  // Справочник
  app.get("/dictionaries/:id", (req, res) => {
    const a = ctx.compiled.registry.get(req.params.id);
    if (!a || a.type !== "dictionary")
      return res.status(404).send("Dictionary not found: " + req.params.id);
    render(res, "dictionary", { dictionary: a }, manifest);
  });

  console.log(
    "[docs] UI available at http://localhost:" +
      (process.env.PORT || 3000) +
      "/",
  );
};
