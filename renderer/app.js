// app.js — renderer process entry point
// No require() allowed here; only window.api.* (from preload) and DOM APIs.
// All functions are kept short and focused.

"use strict";

// ── Tab switching ──────────────────────────────────────────────────────────

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels  = document.querySelectorAll(".panel");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.panel;
      buttons.forEach((b) => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
      panels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      document.getElementById("panel-" + target).classList.add("active");
    });
  });
}

// ── Version badge ──────────────────────────────────────────────────────────

async function initVersion() {
  const ver = await window.api.getVersion();
  // Use textContent, never innerHTML
  document.getElementById("app-version").textContent = "v" + ver;
}

// ── Output helpers ─────────────────────────────────────────────────────────

// Write a success string to an output panel (monospace, plain text)
function showOutput(el, text) {
  el.classList.remove("error-text");
  el.textContent = text;
}

// Write an error string in red
function showError(el, text) {
  el.classList.add("error-text");
  el.textContent = text;
}

// ── JSON parse helper ──────────────────────────────────────────────────────

// Returns { value } on success or { error } string on failure
function tryParseJSON(text) {
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: e.message };
  }
}

// ── Tool 1: JSON Formatter ─────────────────────────────────────────────────

function initFormatter() {
  const input  = document.getElementById("formatter-input");
  const output = document.getElementById("formatter-output");
  const btnP   = document.getElementById("formatter-prettify");
  const btnM   = document.getElementById("formatter-minify");
  const btnC   = document.getElementById("formatter-clear");

  btnP.addEventListener("click", () => {
    const r = tryParseJSON(input.value.trim());
    if (r.error) { showError(output, "Invalid JSON: " + r.error); return; }
    showOutput(output, JSON.stringify(r.value, null, 2));
  });

  btnM.addEventListener("click", () => {
    const r = tryParseJSON(input.value.trim());
    if (r.error) { showError(output, "Invalid JSON: " + r.error); return; }
    showOutput(output, JSON.stringify(r.value));
  });

  btnC.addEventListener("click", () => { input.value = ""; output.textContent = ""; output.classList.remove("error-text"); });
}

// ── Tool 2: JSON Diff ──────────────────────────────────────────────────────

// Recursively collect differences between two parsed JSON values.
// path: string like "$" or "$.user.name"
// Returns array of { path, type: "added"|"removed"|"changed", oldVal, newVal }
function collectDiff(oldVal, newVal, path, results) {
  if (oldVal === newVal) return;

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const isArr = (v) => Array.isArray(v);

  if (isObj(oldVal) && isObj(newVal)) {
    const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
    keys.forEach((k) => collectDiff(oldVal[k], newVal[k], path + "." + k, results));
    return;
  }

  if (isArr(oldVal) && isArr(newVal)) {
    const len = Math.max(oldVal.length, newVal.length);
    for (let i = 0; i < len; i++) {
      collectDiff(oldVal[i], newVal[i], path + "[" + i + "]", results);
    }
    return;
  }

  if (oldVal === undefined) { results.push({ path, type: "added", newVal }); return; }
  if (newVal === undefined) { results.push({ path, type: "removed", oldVal }); return; }
  results.push({ path, type: "changed", oldVal, newVal });
}

// Render a diff results array as coloured lines in the output element.
function renderDiff(output, diffs) {
  output.textContent = "";
  output.classList.remove("error-text");

  if (diffs.length === 0) {
    const line = document.createElement("span");
    line.className = "diff-none";
    line.textContent = "No differences.";
    output.appendChild(line);
    return;
  }

  diffs.forEach((d) => {
    const line = document.createElement("div");
    if (d.type === "added") {
      line.className = "diff-added";
      line.textContent = "+ " + d.path + ": " + JSON.stringify(d.newVal);
    } else if (d.type === "removed") {
      line.className = "diff-removed";
      line.textContent = "- " + d.path + ": " + JSON.stringify(d.oldVal);
    } else {
      line.className = "diff-changed";
      line.textContent = "~ " + d.path + ": " + JSON.stringify(d.oldVal) + " → " + JSON.stringify(d.newVal);
    }
    output.appendChild(line);
  });
}

function initDiff() {
  const orig   = document.getElementById("diff-original");
  const changed = document.getElementById("diff-changed");
  const output = document.getElementById("diff-output");
  const btnCmp = document.getElementById("diff-compare");
  const btnC   = document.getElementById("diff-clear");

  btnCmp.addEventListener("click", () => {
    const rA = tryParseJSON(orig.value.trim());
    const rB = tryParseJSON(changed.value.trim());
    if (rA.error) { showError(output, "Original JSON invalid: " + rA.error); return; }
    if (rB.error) { showError(output, "Changed JSON invalid: " + rB.error); return; }
    const diffs = [];
    collectDiff(rA.value, rB.value, "$", diffs);
    renderDiff(output, diffs);
  });

  btnC.addEventListener("click", () => {
    orig.value = ""; changed.value = ""; output.textContent = "";
    output.classList.remove("error-text");
  });
}

// ── Tool 3: API Tester ─────────────────────────────────────────────────────

// Parse headers textarea; returns { headers } or { error }
function parseHeaders(raw) {
  const text = raw.trim();
  if (!text) return { headers: {} };
  const r = tryParseJSON(text);
  if (r.error) return { error: "Headers must be a JSON object: " + r.error };
  if (typeof r.value !== "object" || Array.isArray(r.value)) {
    return { error: "Headers must be a JSON object (not an array)." };
  }
  return { headers: r.value };
}

// Render API response in the output + status bar elements
function renderApiResponse(statusBar, output, res) {
  // Status bar
  const codeSpan = document.createElement("span");
  codeSpan.className = res.ok ? "status-ok" : "status-error";
  codeSpan.textContent = res.status + " " + res.statusText;
  const timeSpan = document.createElement("span");
  timeSpan.textContent = res.time + " ms";
  statusBar.textContent = "";
  statusBar.appendChild(codeSpan);
  statusBar.appendChild(timeSpan);

  // Body
  const parsed = tryParseJSON(res.body);
  showOutput(output, parsed.error ? res.body : JSON.stringify(parsed.value, null, 2));
}

function initApiTester() {
  const methodSel = document.getElementById("api-method");
  const urlInput  = document.getElementById("api-url");
  const headersTA = document.getElementById("api-headers");
  const bodyTA    = document.getElementById("api-body");
  const btnSend   = document.getElementById("api-send");
  const statusBar = document.getElementById("api-status-bar");
  const output    = document.getElementById("api-output");

  btnSend.addEventListener("click", async () => {
    const hResult = parseHeaders(headersTA.value);
    if (hResult.error) { showError(output, hResult.error); return; }

    const url = urlInput.value.trim();
    if (!url) { showError(output, "Please enter a URL."); return; }

    btnSend.disabled = true;
    btnSend.textContent = "Sending…";
    statusBar.textContent = "";
    output.textContent = "";
    output.classList.remove("error-text");

    const res = await window.api.request({
      method:  methodSel.value,
      url,
      headers: hResult.headers,
      body:    bodyTA.value.trim() || undefined,
    });

    btnSend.disabled = false;
    btnSend.textContent = "Send";

    if (!res.ok && res.error) {
      showError(output, "Network error: " + res.error);
      return;
    }
    renderApiResponse(statusBar, output, res);
  });
}

// ── Tool 4: JSON Converter ─────────────────────────────────────────────────

// --- YAML serializer (no external libs) ---

function scalarNeedsQuotes(s) {
  // Quote strings that look like YAML specials, or contain ": " or start with special chars
  return /^(true|false|null|yes|no|on|off|\d)$/i.test(s) ||
    /[:#\[\]{},&*!|>'"%@`]/.test(s) ||
    s.includes("\n") || s.trim() !== s;
}

function toYamlValue(val, indent) {
  if (val === null) return "null";
  if (typeof val === "boolean" || typeof val === "number") return String(val);
  if (typeof val === "string") {
    return scalarNeedsQuotes(val) ? JSON.stringify(val) : val;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    const pad = " ".repeat(indent + 2);
    return "\n" + val.map((v) => pad + "- " + toYamlValue(v, indent + 2)).join("\n");
  }
  if (typeof val === "object") {
    const keys = Object.keys(val);
    if (keys.length === 0) return "{}";
    const pad = " ".repeat(indent + 2);
    return "\n" + keys.map((k) => pad + k + ": " + toYamlValue(val[k], indent + 2)).join("\n");
  }
  return String(val);
}

function jsonToYaml(parsed, indent) {
  if (Array.isArray(parsed)) {
    return parsed.map((v) => "- " + toYamlValue(v, indent)).join("\n");
  }
  if (typeof parsed === "object" && parsed !== null) {
    return Object.keys(parsed)
      .map((k) => k + ": " + toYamlValue(parsed[k], indent))
      .join("\n");
  }
  return toYamlValue(parsed, 0);
}

// --- CSV serializer ---

function csvEscape(val) {
  const s = val === null || val === undefined ? "" : String(val);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function jsonToCsv(parsed) {
  if (!Array.isArray(parsed)) return { error: "CSV requires a JSON array of objects." };
  if (parsed.length === 0) return { csv: "" };

  const nonObjects = parsed.filter((r) => typeof r !== "object" || r === null || Array.isArray(r));
  if (nonObjects.length) return { error: "CSV requires all array items to be objects." };

  const headers = [...new Set(parsed.flatMap((r) => Object.keys(r)))];
  const rows    = parsed.map((r) => headers.map((h) => csvEscape(r[h])).join(","));
  return { csv: [headers.map(csvEscape).join(","), ...rows].join("\n") };
}

// --- TypeScript interface generator ---

function jsTypeOf(val) {
  if (val === null) return "null";
  if (Array.isArray(val)) {
    const inner = val.length ? jsTypeOf(val[0]) : "unknown";
    return inner + "[]";
  }
  return typeof val;
}

// Returns { lines: string[], interfaces: string[] }
function buildInterface(name, obj, ifaces) {
  const lines = ["interface " + name + " {"];
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const childName = name + capitalize(k);
      buildInterface(childName, v, ifaces);
      lines.push("  " + k + ": " + childName + ";");
    } else {
      lines.push("  " + k + ": " + jsTypeOf(v) + ";");
    }
  });
  lines.push("}");
  ifaces.push(lines.join("\n"));
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function jsonToTypeScript(parsed) {
  const ifaces = [];
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    buildInterface("Root", parsed, ifaces);
  } else if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === "object") {
    buildInterface("Item", parsed[0], ifaces);
    ifaces[ifaces.length - 1] = ifaces[ifaces.length - 1] + "\n\ntype Root = Item[];";
  } else {
    return "// Cannot generate interfaces for this JSON shape.\ntype Root = " + jsTypeOf(parsed) + ";";
  }
  return ifaces.join("\n\n");
}

// --- Converter tool init ---

function initConverter() {
  const input  = document.getElementById("converter-input");
  const output = document.getElementById("converter-output");
  const btnY   = document.getElementById("converter-yaml");
  const btnC   = document.getElementById("converter-csv");
  const btnT   = document.getElementById("converter-ts");
  const btnCl  = document.getElementById("converter-clear");

  function getParsed() {
    const r = tryParseJSON(input.value.trim());
    if (r.error) { showError(output, "Invalid JSON: " + r.error); return null; }
    return r.value;
  }

  btnY.addEventListener("click", () => {
    const parsed = getParsed(); if (parsed === null) return;
    showOutput(output, jsonToYaml(parsed, 0));
  });

  btnC.addEventListener("click", () => {
    const parsed = getParsed(); if (parsed === null) return;
    const res = jsonToCsv(parsed);
    if (res.error) { showError(output, res.error); return; }
    showOutput(output, res.csv);
  });

  btnT.addEventListener("click", () => {
    const parsed = getParsed(); if (parsed === null) return;
    showOutput(output, jsonToTypeScript(parsed));
  });

  btnCl.addEventListener("click", () => {
    input.value = ""; output.textContent = ""; output.classList.remove("error-text");
  });
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

initTabs();
initVersion();
initFormatter();
initDiff();
initApiTester();
initConverter();
