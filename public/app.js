// Presentation layer only. All fingerprinting logic lives in collector.js (browser side) and
// the server (API side) -- this file just renders whatever GET /api/v1/signals and the
// "plzbot:fingerprint" event (dispatched by collector.js once it POSTs and gets the combined
// fingerprint back) hand it. See docs/API.md.

const CATEGORY_LABELS = {
  network: "Network",
  tls: "TLS",
  http: "HTTP",
  http2: "HTTP/2",
  clientHints: "Client Hints",
  navigator: "Navigator",
  screen: "Screen",
  hardware: "Hardware",
  graphics: "Graphics (Canvas / WebGL)",
  audio: "Audio",
  fonts: "Fonts",
  media: "Media",
  storage: "Storage",
  apis: "Browser APIs",
  automation: "Automation Indicators",
};

const CATEGORY_BLURBS = {
  network: "What the server saw at the TCP/IP level, plus proxy headers (shown but untrusted by default).",
  tls: "The TLS handshake, captured before Node's TLS engine processes it -- see docs/TLS_CAPTURE.md.",
  http: "The HTTP request line and headers, raw and parsed.",
  http2: "HTTP/2-specific protocol characteristics (only populated for HTTP/2 requests).",
  clientHints: "Structured, opt-in replacements for parts of the User-Agent string.",
  navigator: "What the page's JavaScript can read directly off `navigator`.",
  screen: "Display geometry and pixel characteristics.",
  hardware: "CPU/memory/touch/network hints exposed to JavaScript.",
  graphics: "Canvas and WebGL rendering fingerprints.",
  audio: "AudioContext-based rendering fingerprint.",
  fonts: "Locally installed fonts detected via canvas text-metrics probing.",
  media: "Codec support and media-query-based preference signals.",
  storage: "Availability of browser storage mechanisms.",
  apis: "A broad sweep of browser API availability.",
  automation: "Signals associated with browser automation / WebDriver control.",
};

let catalog = {};
let fingerprint = null;

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else node.setAttribute(k, v);
    }
  }
  for (const child of children ?? []) {
    if (child) node.appendChild(child);
  }
  return node;
}

function formatValue(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function renderStatusLine(text, spinning) {
  const line = document.getElementById("status-line");
  line.innerHTML = "";
  if (spinning) line.appendChild(el("span", { class: "spinner" }));
  line.appendChild(el("span", { text }));
}

function confidenceBadge(confidence, text) {
  return el("span", { class: `badge confidence-${confidence}`, text });
}

function renderBadges(fp) {
  const container = document.getElementById("badges");
  container.innerHTML = "";

  const isBrowser = fp.client !== null;
  container.appendChild(
    el("span", { class: `badge ${isBrowser ? "tone-good" : ""}`, text: isBrowser ? "Browser client (JS ran)" : "Non-browser HTTP client" }),
  );
  container.appendChild(el("span", { class: "badge", text: `HTTP/${fp.request.httpVersion}` }));

  const alpn = findObs(fp, "tls.alpn_negotiated");
  if (alpn?.status === "observed") container.appendChild(el("span", { class: "badge", text: `ALPN: ${alpn.raw}` }));

  const tlsVersion = findObs(fp, "tls.negotiated_protocol");
  if (tlsVersion?.status === "observed") container.appendChild(el("span", { class: "badge", text: tlsVersion.raw }));

  const automationAssessments = fp.interpretation.assessments.filter((a) => a.category === "automation");
  if (automationAssessments.length > 0) {
    const top = automationAssessments.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))[0];
    container.appendChild(confidenceBadge(top.confidence, `Automation evidence: ${top.confidence}`));
  } else {
    container.appendChild(el("span", { class: "badge tone-good", text: "No automation evidence found" }));
  }

  const conflicts = fp.interpretation.assessments.filter((a) => a.conflicting);
  if (conflicts.length > 0) {
    container.appendChild(el("span", { class: "badge confidence-medium", text: `${conflicts.length} signal conflict${conflicts.length === 1 ? "" : "s"}` }));
  }
}

function confidenceRank(c) {
  return { high: 3, medium: 2, low: 1, informational: 0 }[c] ?? 0;
}

function findObs(fp, id) {
  const groups = [...Object.values(fp.server), ...(fp.client ? Object.values(fp.client).filter(Array.isArray) : [])];
  for (const g of groups) {
    if (!Array.isArray(g)) continue;
    const hit = g.find((o) => o.id === id);
    if (hit) return hit;
  }
  return null;
}

function renderAssessments(fp) {
  const section = document.getElementById("assessments-section");
  const list = document.getElementById("assessments-list");
  list.innerHTML = "";

  const assessments = [...fp.interpretation.assessments].sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
  if (assessments.length === 0) {
    list.appendChild(el("p", { class: "lead", text: "No cross-signal assessments were triggered for this fingerprint." }));
    return;
  }

  for (const a of assessments) {
    const card = el("div", { class: "assessment-card" }, [
      el("div", { class: "row" }, [
        confidenceBadge(a.confidence, a.confidence),
        el("span", { class: "badge", text: a.category }),
        a.conflicting ? el("span", { class: "badge confidence-medium", text: "conflict" }) : null,
      ]),
      el("div", { class: "title", text: a.title }),
      el("p", { class: "statement", text: a.statement }),
      el("div", { class: "evidence", text: `evidence: ${[...a.evidence.observationIds, ...a.evidence.derivedIds].join(", ") || "none"}` }),
      a.references?.length
        ? el(
            "div",
            { class: "refs" },
            a.references.map((r) => el("div", {}, [el("a", { href: r.url, target: "_blank", rel: "noopener", text: r.title })])),
          )
        : null,
    ]);
    list.appendChild(card);
  }
  section.hidden = false;
}

function infoPanelContent(id) {
  const entry = catalog[id];
  if (!entry) return el("p", { text: "No catalog entry yet for this signal." });
  const parts = [
    el("p", {}, [el("span", { class: "label", text: entry.title })]),
    el("p", { text: entry.description }),
    el("p", {}, [el("span", { class: "label", text: "Why it matters: " }), document.createTextNode(entry.whyItMatters)]),
  ];
  if (entry.caveats) parts.push(el("p", {}, [el("span", { class: "label", text: "Caveats: " }), document.createTextNode(entry.caveats)]));
  if (entry.references?.length) {
    parts.push(
      el(
        "p",
        {},
        entry.references.map((r, i) => el("a", { href: r.url, target: "_blank", rel: "noopener", text: (i ? " · " : "") + r.title })),
      ),
    );
  }
  return el("div", {}, parts);
}

function colgroup() {
  return el("colgroup", {}, [
    el("col", { class: "col-id" }),
    el("col", { class: "col-status" }),
    el("col", { class: "col-value" }),
    el("col", { class: "col-method" }),
  ]);
}

function renderObservationTable(observations) {
  const table = el("table", { class: "obs-table" }, [
    colgroup(),
    el("thead", {}, [el("tr", {}, [el("th", { text: "signal" }), el("th", { text: "status" }), el("th", { text: "value" }), el("th", { text: "method" })])]),
  ]);
  const tbody = el("tbody");
  for (const o of observations) {
    const hasInfo = Boolean(catalog[o.id]);
    const row = el("tr", { class: `obs-row ${hasInfo ? "has-info" : ""}` }, [
      el("td", { class: "id", text: o.id }),
      el("td", {}, [el("span", { class: `pill ${o.status}`, text: o.status })]),
      el("td", { class: "value" }, [
        el("span", { text: formatValue(o.raw) }),
        o.normalized !== undefined && JSON.stringify(o.normalized) !== JSON.stringify(o.raw)
          ? el("span", { class: "normalized", text: `normalized: ${formatValue(o.normalized)}` })
          : null,
        o.error ? el("span", { class: "normalized", text: `error: ${o.error}` }) : null,
      ]),
      el("td", { class: "method", text: o.collectionMethod }),
    ]);
    tbody.appendChild(row);

    if (hasInfo) {
      const infoRow = el("tr", { class: "info-row", style: "display:none" }, [
        el("td", { colspan: "4", style: "padding:0" }, [el("div", { class: "info-panel" }, [infoPanelContent(o.id)])]),
      ]);
      infoRow.style.display = "none";
      tbody.appendChild(infoRow);
      row.addEventListener("click", () => {
        infoRow.style.display = infoRow.style.display === "none" ? "table-row" : "none";
      });
    }
  }
  table.appendChild(tbody);
  return table;
}

function renderSignalExplorer(fp) {
  const container = document.getElementById("signal-explorer");
  container.innerHTML = "";

  const groups = { ...fp.server };
  if (fp.client) Object.assign(groups, Object.fromEntries(Object.entries(fp.client).filter(([k]) => k !== "status")));

  for (const [key, observations] of Object.entries(groups)) {
    if (!Array.isArray(observations)) continue;
    const observedCount = observations.filter((o) => o.status === "observed").length;
    const details = el("details", { class: "category" }, [
      el("summary", {}, [
        el("span", { text: CATEGORY_LABELS[key] ?? key }),
        el("span", { class: "meta", text: `${observedCount}/${observations.length} observed` }),
      ]),
    ]);
    const body = el("div", { style: "padding: 0 1rem 1rem" }, [
      el("p", { class: "lead", style: "margin: 0.5rem 0 0.7rem", text: CATEGORY_BLURBS[key] ?? "" }),
      renderObservationTable(observations),
    ]);
    details.appendChild(body);
    container.appendChild(details);
  }
}

function renderDerived(fp) {
  const container = document.getElementById("derived-list");
  container.innerHTML = "";
  const table = el("table", { class: "obs-table" }, [
    colgroup(),
    el("thead", {}, [el("tr", {}, [el("th", { text: "id" }), el("th", { text: "status" }), el("th", { text: "value" }), el("th", { text: "method" })])]),
  ]);
  const tbody = el("tbody");
  for (const d of fp.derived) {
    tbody.appendChild(
      el("tr", {}, [
        el("td", { class: "id", text: d.id }),
        el("td", {}, [el("span", { class: `pill ${d.status === "computed" ? "observed" : d.status}`, text: d.status })]),
        el("td", { class: "value", text: formatValue(d.value) }),
        el("td", { class: "method", text: d.method }),
      ]),
    );
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderRawToggle(fp) {
  const btn = document.getElementById("raw-toggle");
  const pre = document.getElementById("raw-json");
  btn.addEventListener("click", () => {
    const showing = pre.style.display !== "none";
    pre.style.display = showing ? "none" : "block";
    btn.textContent = showing ? "Show raw JSON" : "Hide raw JSON";
    if (!showing) pre.textContent = JSON.stringify(fp, null, 2);
  });
}

function render(fp) {
  fingerprint = fp;
  renderStatusLine(`Fingerprint combined — schema v${fp.schemaVersion}, id ${fp.fingerprintId.slice(0, 8)}…`, false);
  renderBadges(fp);
  renderAssessments(fp);
  renderDerived(fp);
  renderSignalExplorer(fp);
  renderRawToggle(fp);
  document.getElementById("results").hidden = false;
}

async function init() {
  renderStatusLine("Server-side signals captured. Waiting on browser collector…", true);
  try {
    const res = await fetch("/api/v1/signals");
    const data = await res.json();
    catalog = data.signals ?? {};
  } catch {
    catalog = {};
  }

  if (window.__plzbotFingerprint) {
    render(window.__plzbotFingerprint);
  } else {
    window.addEventListener("plzbot:fingerprint", (e) => render(e.detail));
  }
}

init();
