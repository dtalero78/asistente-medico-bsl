// Reporte — render del informe. Los estudios devuelven datos; aquí se pintan.
// Está organizado en secciones para que el informe crezca con cada estudio sin
// que ninguno tenga que saber cómo se dibujan los demás.

const $ = (id) => document.getElementById(id);

export const fmt = (v, dec = 2) => (v == null ? "—" : Number(v).toFixed(dec));

export function clear() {
  $("reportSections").innerHTML = "";
}

export function setMeta(text) {
  $("reportMeta").textContent =
    text || "Generado: " + new Date().toLocaleString("es-CO") + " · Procesado localmente";
}

/**
 * Agrega una sección al informe.
 * @param {object} spec
 * @param {string} spec.title    encabezado de la sección
 * @param {string} [spec.note]   línea de contexto o limitación bajo el título
 * @param {Array}  [spec.media]  [{caption, canvas, downloadName}]
 * @param {Array}  [spec.rows]   [{label, od, oi, reading, exp}] o [{label, value, reading, exp}]
 * @param {Array}  [spec.flags]  [["ok"|"warn", mensaje]]
 * @param {Node}   [spec.extra]  nodo libre (gráfica, tabla propia…)
 */
export function addSection(spec) {
  const host = $("reportSections");
  const sec = document.createElement("section");
  sec.className = "report-section";

  const h = document.createElement("h3");
  h.textContent = spec.title;
  sec.appendChild(h);

  if (spec.note) {
    const n = document.createElement("p");
    n.className = "section-note";
    n.textContent = spec.note;
    sec.appendChild(n);
  }

  if (spec.media && spec.media.length) sec.appendChild(mediaGrid(spec.media));
  if (spec.rows && spec.rows.length) sec.appendChild(metricsTable(spec.rows));
  if (spec.extra) sec.appendChild(spec.extra);
  if (spec.flags && spec.flags.length) sec.appendChild(flagList(spec.flags));

  host.appendChild(sec);
  return sec;
}

function mediaGrid(items) {
  const grid = document.createElement("div");
  grid.className = "eyes";
  items.forEach((it) => {
    const fig = document.createElement("figure");
    fig.className = "eye-card";

    const cap = document.createElement("figcaption");
    cap.textContent = it.caption;
    fig.appendChild(cap);

    it.canvas.classList.add("eye-img");
    fig.appendChild(it.canvas);

    if (it.downloadName) {
      const btn = document.createElement("button");
      btn.className = "btn tiny ghost";
      btn.textContent = "⬇ Imagen";
      btn.addEventListener("click", () => {
        const a = document.createElement("a");
        a.download = it.downloadName;
        a.href = it.canvas.toDataURL("image/png");
        a.click();
      });
      fig.appendChild(btn);
    }
    grid.appendChild(fig);
  });
  return grid;
}

function metricsTable(rows) {
  const perEye = rows.some((r) => r.od !== undefined || r.oi !== undefined);
  const table = document.createElement("table");
  table.className = "metrics";

  const thead = document.createElement("thead");
  thead.innerHTML = perEye
    ? "<tr><th>Observación</th><th>OD</th><th>OI</th><th>Lectura</th></tr>"
    : "<tr><th>Observación</th><th>Valor</th><th>Lectura</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    const label = `${escapeHtml(r.label)}${r.exp ? ' <span class="exp">experimental</span>' : ""}`;
    const reading = `<td class="reading">${escapeHtml(r.reading || "")}</td>`;
    if (perEye) {
      // Una fila sin od/oi (métrica global) ocupa las dos columnas de ojo.
      const cells = r.od !== undefined || r.oi !== undefined
        ? `<td>${escapeHtml(r.od)}</td><td>${escapeHtml(r.oi)}</td>`
        : `<td colspan="2">${escapeHtml(r.value)}</td>`;
      tr.innerHTML = `<td>${label}</td>${cells}${reading}`;
    } else {
      tr.innerHTML = `<td>${label}</td><td>${escapeHtml(r.value)}</td>${reading}`;
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  scroll.appendChild(table);
  return scroll;
}

function flagList(flags) {
  const box = document.createElement("div");
  box.className = "flags";
  flags.forEach(([type, msg]) => {
    const d = document.createElement("div");
    d.className = "flag " + type;
    d.textContent = (type === "ok" ? "✓ " : "⚠ ") + msg;
    box.appendChild(d);
  });
  return box;
}

function escapeHtml(v) {
  return String(v == null ? "—" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// --------- Minigráfica de línea (para series temporales) ---------
// Canvas y no SVG: son cientos de puntos y sale más barato y más nítido.
export function sparkline(values, { width = 640, height = 90, bands = [] } = {}) {
  const c = document.createElement("canvas");
  c.className = "spark";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = width * dpr; c.height = height * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);

  const vs = values.filter((v) => v != null && !Number.isNaN(v));
  if (vs.length < 2) return c;
  const min = Math.min(...vs), max = Math.max(...vs);
  const span = max - min || 1;
  const x = (i) => (i / (values.length - 1)) * width;
  const y = (v) => height - ((v - min) / span) * (height - 8) - 4;

  // bandas de referencia horizontales (p. ej. el umbral de cierre)
  bands.forEach((b) => {
    g.fillStyle = b.color;
    const y1 = y(b.from), y2 = y(b.to);
    g.fillRect(0, Math.min(y1, y2), width, Math.abs(y2 - y1));
  });

  g.strokeStyle = "#2f81f7";
  g.lineWidth = 1.5;
  g.lineJoin = "round";
  g.beginPath();
  let started = false;
  values.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) { started = false; return; } // hueco: cortar la línea
    if (!started) { g.moveTo(x(i), y(v)); started = true; }
    else g.lineTo(x(i), y(v));
  });
  g.stroke();
  return c;
}
