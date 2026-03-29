"use strict";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripLeadingIf(text) {
  return String(text || "").replace(/^если\s+/i, "").trim();
}

function renderWhenText(expr, renderLeaf, opts) {
  const options = Object.assign(
    {
      joinAll: " и ",
      joinAny: " или ",
      wrapGroups: true,
      stripLeadingIf: false,
    },
    opts || {},
  );

  function leafText(ref) {
    const raw = renderLeaf(ref);
    return options.stripLeadingIf ? stripLeadingIf(raw) : raw;
  }

  function walk(node, isRoot) {
    if (!node) return "";
    if (node.mode === "single") {
      return leafText(node.predId || node.pred || node.ref || "");
    }
    const joiner = node.mode === "any" ? options.joinAny : options.joinAll;
    const parts = (node.items || []).map((item) => walk(item, false)).filter(Boolean);
    if (parts.length === 0) return "";
    const body = parts.join(joiner);
    if (!options.wrapGroups || isRoot || parts.length === 1) return body;
    return `(${body})`;
  }

  return walk(expr, true);
}

function renderWhenTreeHtml(expr, renderLeafHtml, opts) {
  const options = Object.assign(
    {
      className: "when-tree",
      labelAll: "Все условия",
      labelAny: "Любое из условий",
      rootPrefixAll: "Выполнены все эти условия",
      rootPrefixAny: "Выполнено одно из этих условий" ,
    },
    opts || {},
  );

  function walk(node, depth) {
    if (!node) return "";
    if (node.mode === "single") {
      return `<li class="${options.className}__item ${options.className}__item--leaf"><div class="${options.className}__leaf">${renderLeafHtml(node.predId || node.pred || node.ref || "")}</div></li>`;
    }
    const items = node.items || [];
    if (depth === 0 && items.length === 1) {
      return walk(items[0], depth);
    }
    const label = node.mode === "any" ? options.labelAny : options.labelAll;
    const inner = items.map((item) => walk(item, depth + 1)).join("");
    const title = depth === 0
      ? (node.mode === "any" ? options.rootPrefixAny : options.rootPrefixAll)
      : label;
    const badge = depth === 0 ? '' : `<div class="${options.className}__badge ${options.className}__badge--${escapeHtml(node.mode)}">${escapeHtml(node.mode.toUpperCase())}</div>`;
    return [
      `<li class="${options.className}__item ${options.className}__item--group ${options.className}__item--group-${escapeHtml(node.mode)}">`,
      `<div class="${options.className}__group">`,
      `<div class="${options.className}__group-head">${badge}<div class="${options.className}__label">${escapeHtml(title)}</div></div>`,
      `<ul class="${options.className}__children">${inner}</ul>`,
      `</div>`,
      `</li>`,
    ].join("");
  }

  return `<ul class="${options.className} ${options.className}--root">${walk(expr, 0)}</ul>`;
}

function collectWhenLeafIds(expr, out) {
  const target = out || [];
  if (!expr) return target;
  if (expr.mode === "single") {
    target.push(expr.predId || expr.pred || expr.ref || "");
    return target;
  }
  for (const item of expr.items || []) collectWhenLeafIds(item, target);
  return target;
}

module.exports = {
  escapeHtml,
  stripLeadingIf,
  renderWhenText,
  renderWhenTreeHtml,
  collectWhenLeafIds,
};
