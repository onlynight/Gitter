(function(jsxRuntime, react) {
  "use strict";
  var _a, _b;
  function U() {
    const g = window.GITTER_UI;
    if (!g) throw new Error("GITTER_UI 未注入（外部页必须经宿主 pageLoader 装载）");
    return g;
  }
  const BOOT = ((_b = (_a = window.GITTER_UI) == null ? void 0 : _a.getActiveCaller) == null ? void 0 : _b.call(_a)) ?? null;
  (() => {
    var _a2, _b2;
    try {
      return ((_b2 = (_a2 = window.GITTER_UI) == null ? void 0 : _a2.pageDocs) == null ? void 0 : _b2.call(_a2)) ?? null;
    } catch {
      return null;
    }
  })();
  const pageSdk = {
    call: (method, params) => {
      const g = U();
      return BOOT ? g.callWith(BOOT, method, params) : g.call(method, params);
    },
    t: (key, ...args) => U().t(key, ...args),
    navigate: (page) => U().navigate(page),
    repo: () => U().repo(),
    focusTask: (taskId) => U().focusTask(taskId)
  };
  const K = () => {
    const k = window.GITTER_KIT;
    if (!k) throw new Error("GITTER_KIT 未注入（外部页必须经宿主 pageLoader 装载）");
    return k;
  };
  const React = K().React;
  K().ReactDOM;
  const ReactDOMClient = K().ReactDOMClient;
  K().DiffView;
  K().diffStatusLetter;
  K().renderSegments;
  K().wordDiff;
  K().SplitPane;
  K().Banner;
  K().Modal;
  K().useContextMenu;
  K().SyncBar;
  K().useSyncProgress;
  K().renderMarkdown;
  K().registerMarkdownPlugin;
  const PageErrorBoundary = K().PageErrorBoundary;
  const NavIcon = K().NavIcon;
  K().Select;
  K().ReflogDialog;
  K().ScrollArea;
  const { call, t, navigate, repo, focusTask } = pageSdk;
  const MODEL_COLORS = ["#F85149", "#E3B341", "#3FB950", "#2DD4BF", "#6BABF5", "#8250DF"];
  const MODEL_DOT = (ref) => {
    let h = 0;
    for (let i = 0; i < ref.length; i++) h = h * 31 + ref.charCodeAt(i) >>> 0;
    return MODEL_COLORS[h % MODEL_COLORS.length];
  };
  const MODEL_DASH = ["none", "none", "10 5", "7 4", "14 6", "4 4"];
  const MODEL_DASH_OF = (ref) => {
    let h = 0;
    for (let i = 0; i < ref.length; i++) h = h * 31 + ref.charCodeAt(i) >>> 0;
    return MODEL_DASH[h % MODEL_DASH.length];
  };
  const modelName = (names, ref) => {
    if (ref === "(未记录)") return ref;
    const bare = ref.split("#")[0];
    return names[bare] ?? names[ref] ?? (bare !== ref ? `${bare} · ${ref.split("#")[1]}` : bare);
  };
  function fmtTok(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(n);
  }
  function fmtCost(n) {
    return n === null ? "—" : "$" + n.toFixed(n < 10 ? 4 : 2);
  }
  function fmtAgo(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const now = /* @__PURE__ */ new Date();
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, now)) {
      const mins = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 6e4));
      if (mins < 1) return t("Usage_JustNow");
      if (mins < 60) return t("Usage_MinAgo", mins);
      return t("Usage_HourAgo", Math.floor(mins / 60));
    }
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    if (sameDay(d, y)) return t("Usage_Yesterday", `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
    return `${d.getMonth() + 1}-${d.getDate()}`;
  }
  function trendOf(cur, prev) {
    if (!prev) return null;
    const pct = Math.round((cur / prev - 1) * 100);
    return { dir: pct >= 0 ? "up" : "down", pct: Math.abs(pct) };
  }
  function sumWindow(rows) {
    const s = { turns: 0, input: 0, output: 0, cache: 0, cost: null };
    for (const r of rows) {
      s.turns += r.turns;
      s.input += r.inputTokens;
      s.output += r.outputTokens;
      s.cache += r.cacheReadTokens;
      if (r.cost !== null) s.cost = (s.cost ?? 0) + r.cost;
    }
    return s;
  }
  function windowOf(rep, days) {
    const all = rep.byDay.map((d) => ({
      day: d.day,
      label: d.day.slice(5).replace("-", "/"),
      turns: d.turns,
      inputTokens: d.inputTokens,
      outputTokens: d.outputTokens,
      cacheReadTokens: d.cacheReadTokens,
      cost: d.cost,
      cacheRate: d.inputTokens > 0 ? d.cacheReadTokens / d.inputTokens : 0
    }));
    if (!days) return { cur: all, prev: [] };
    const cur = all.slice(-days);
    return { cur, prev: all.slice(-days * 2, -days) };
  }
  const TREND_W = 1e3;
  const TREND_H = 168;
  const MT_W = 1400, MT_H = 156;
  const PAD_L = 34, PAD_R = 38, PAD_T = 10, PAD_B = 20;
  const MT_PAD_T = 10;
  function modelsOfDay(rep, day) {
    return rep.filter((m) => m.day === day).sort((a, b) => b.inputTokens - a.inputTokens);
  }
  function clampTip(x, boxRef) {
    const box = boxRef.current;
    if (!box) return `${x}px`;
    const half = 100;
    const lo = Math.max(6, -(half - box.offsetWidth));
    return `${Math.min(Math.max(x, lo), box.offsetWidth + half - 6)}px`;
  }
  function smooth(pts) {
    const m = pts.length;
    if (m === 0) return "";
    if (m === 1) return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    if (m === 2) return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} L${pts[1][0].toFixed(1)} ${pts[1][1].toFixed(1)}`;
    const dx = new Array(m).fill(0);
    const sl = new Array(m).fill(0);
    for (let i = 1; i < m; i++) dx[i - 1] = pts[i][0] - pts[i - 1][0];
    for (let i = 1; i < m - 1; i++) sl[i] = (pts[i + 1][1] - pts[i - 1][1]) / (dx[i] + dx[i - 1]);
    sl[0] = (pts[1][1] - pts[0][1]) / (dx[0] || 1);
    sl[m - 1] = (pts[m - 1][1] - pts[m - 2][1]) / (dx[m - 2] || 1);
    for (let i = 0; i < m - 1; i++) {
      if (pts[i][1] === pts[i + 1][1]) {
        sl[i] = 0;
        sl[i + 1] = 0;
        continue;
      }
      const a = sl[i] / sl[i + 1];
      if (a <= 0) {
        sl[i] = 0;
        sl[i + 1] = 0;
        continue;
      }
      const d2 = Math.hypot(a, 1);
      if (d2 > 3) {
        sl[i] = 3 * sl[i + 1] / a;
        sl[i + 1] = 3 * sl[i + 1] / a;
      }
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < m - 1; i++) {
      const p1 = pts[i], p2 = pts[i + 1];
      const k = (dx[i] || 1) / 3;
      d += ` C${(p1[0] + k).toFixed(1)} ${(p1[1] + sl[i] * k).toFixed(1)} ${(p2[0] - k).toFixed(1)} ${(p2[1] - sl[i + 1] * k).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }
  function TrendChart(props) {
    const { rows } = props;
    const wrapRef = react.useRef(null);
    const [cw, setCw] = react.useState(TREND_W);
    react.useLayoutEffect(() => {
      const el = wrapRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => setCw(Math.max(360, el.clientWidth)));
      ro.observe(el);
      setCw(Math.max(360, el.clientWidth));
      return () => ro.disconnect();
    }, []);
    const W = Math.round(cw);
    const iw = W - PAD_L - PAD_R;
    const ih = TREND_H - PAD_T - PAD_B;
    const n = Math.max(1, rows.length);
    const slot = iw / n;
    const maxTok = Math.max(1, ...rows.map((r) => Math.max(r.inputTokens, r.cacheReadTokens, r.outputTokens))) * 1.12;
    const maxCost = Math.max(1e-9, ...rows.map((r) => r.cost ?? 0)) * 1.25;
    const x = (i) => PAD_L + slot * i + slot / 2;
    const yT = (v) => PAD_T + ih - v / maxTok * ih;
    const yC = (v) => PAD_T + ih - v / maxCost * ih;
    const parts = [];
    for (let g = 0; g <= 3; g++) {
      const y = PAD_T + ih - ih * g / 3;
      parts.push(`<line class="gl" x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}"/>`);
      parts.push(`<text class="ax ax-y" x="${PAD_L - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtTok(maxTok * g / 3)}</text>`);
      parts.push(`<text class="ax ax-yr" x="${W - PAD_R + 5}" y="${(y + 3).toFixed(1)}" text-anchor="start">$${(maxCost * g / 3).toFixed(0)}</text>`);
    }
    parts.push(`<line class="baseline" x1="${PAD_L}" y1="${PAD_T + ih}" x2="${W - PAD_R}" y2="${PAD_T + ih}"/>`);
    const isKey = (arr) => {
      const mx = Math.max(...arr);
      const key = /* @__PURE__ */ new Set();
      key.add(0);
      key.add(n - 1);
      arr.forEach((v, i) => {
        if (v === mx) key.add(i);
      });
      return key;
    };
    const keySet = /* @__PURE__ */ new Set();
    const series = [
      ["input", rows.map((r) => r.inputTokens), "#9AA6B2"],
      ["cache", rows.map((r) => r.cacheReadTokens), "#4C5866"],
      ["output", rows.map((r) => r.outputTokens), "#6BABF5"]
    ];
    if (props.vis.cost) series.push(["cost", rows.map((r) => r.cost ?? 0), "#E3B341"]);
    for (const [name, vals] of series) {
      if (!props.vis[name]) continue;
      for (const i of isKey(vals)) keySet.add(i);
    }
    const step = n <= 7 ? 1 : Math.max(1, Math.round(n / 7));
    rows.forEach((r, i) => {
      if (i % step === 0 || i === n - 1)
        parts.push(`<text class="ax ax-x" x="${x(i).toFixed(1)}" y="${TREND_H - 5}" text-anchor="middle">${r.label}</text>`);
    });
    if (props.vis.input) {
      const pts = rows.map((r, i) => [x(i), yT(r.inputTokens)]);
      const d = smooth(pts);
      parts.push(`<path class="ln-fill" d="${d} L${x(n - 1).toFixed(1)} ${PAD_T + ih} L${x(0).toFixed(1)} ${PAD_T + ih} Z"/>`);
      parts.push(`<path class="ln ln-in" d="${d}"/>`);
    }
    if (props.vis.cache) {
      parts.push(`<path class="ln ln-cache" d="${smooth(rows.map((r, i) => [x(i), yT(r.cacheReadTokens)]))}"/>`);
    }
    if (props.vis.output) {
      parts.push(`<path class="ln ln-out" d="${smooth(rows.map((r, i) => [x(i), yT(r.outputTokens)]))}"/>`);
    }
    if (props.vis.cost) {
      parts.push(`<path class="ln ln-cost" d="${smooth(rows.map((r, i) => [x(i), yC(r.cost ?? 0)]))}"/>`);
    }
    const dotOf = (name, vals, color) => {
      for (const i of keySet) {
        if (!props.vis[name]) continue;
        const r = rows[i];
        if (!r) continue;
        const y = name === "cost" ? yC(vals[i]) : yT(vals[i]);
        parts.push(`<circle class="node" data-i="${i}" cx="${x(i).toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${color}"/>`);
      }
    };
    dotOf("input", rows.map((r) => r.inputTokens), "#9AA6B2");
    dotOf("cache", rows.map((r) => r.cacheReadTokens), "#6E7C8C");
    dotOf("output", rows.map((r) => r.outputTokens), "#6BABF5");
    if (props.vis.cost) dotOf("cost", rows.map((r) => r.cost ?? 0), "#E3B341");
    rows.forEach((_, i) => {
      parts.push(`<rect class="hit" data-i="${i}" x="${(PAD_L + slot * i).toFixed(1)}" y="${PAD_T}" width="${slot.toFixed(1)}" height="${ih.toFixed(1)}"/>`);
    });
    const show = (e) => {
      const i = e.currentTarget.getAttribute("data-i");
      if (i == null) return;
      const row = rows[Number(i)];
      if (!row || !wrapRef.current) return;
      const wb = wrapRef.current.getBoundingClientRect();
      const cx = e.currentTarget.getBoundingClientRect();
      props.onTip({ x: cx.left + cx.width / 2 - wb.left, row, models: modelsOfDay(props.models, row.day) });
    };
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "trend-wrap", ref: wrapRef, children: /* @__PURE__ */ jsxRuntime.jsx(
      "svg",
      {
        className: "trend",
        viewBox: `0 0 ${W} ${TREND_H}`,
        preserveAspectRatio: "none",
        dangerouslySetInnerHTML: { __html: parts.join("") },
        onMouseOver: (e) => {
          console.debug("[usage-tip]", e.type, e.target.tagName);
          show(e);
        },
        onMouseEnter: (e) => show(e),
        onMouseOut: (e) => {
          if (!(e.relatedTarget instanceof Element && e.currentTarget.contains(e.relatedTarget))) props.onTip(null);
        },
        onMouseLeave: () => props.onTip(null)
      }
    ) });
  }
  const MAX_MODELS = 6;
  function ModelTrendChart(props) {
    const { rows } = props;
    const wrapRef = react.useRef(null);
    const [cw, setCw] = react.useState(MT_W);
    react.useLayoutEffect(() => {
      const el = wrapRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => setCw(Math.max(360, el.clientWidth)));
      ro.observe(el);
      setCw(Math.max(360, el.clientWidth));
      return () => ro.disconnect();
    }, []);
    const W = Math.round(cw);
    const iw = W - PAD_L - PAD_R;
    const ih = MT_H - MT_PAD_T - PAD_B;
    const n = Math.max(1, rows.length);
    const slot = iw / n;
    const series = props.models.slice(0, MAX_MODELS).map((m) => {
      const map = new Map(props.byDayModel.filter((d) => d.modelRef === m.modelRef).map((d) => [d.day, d]));
      return {
        modelRef: m.modelRef,
        name: modelName(props.modelNames, m.modelRef),
        color: MODEL_DOT(m.modelRef),
        dash: MODEL_DASH_OF(m.modelRef),
        vals: rows.map((r) => {
          var _a2;
          return ((_a2 = map.get(r.day)) == null ? void 0 : _a2.inputTokens) ?? 0;
        }),
        out: rows.map((r) => {
          var _a2;
          return ((_a2 = map.get(r.day)) == null ? void 0 : _a2.outputTokens) ?? 0;
        })
      };
    });
    const maxTok = Math.max(1, ...series.flatMap((s) => s.vals)) * 1.12;
    const x = (i) => PAD_L + slot * i + slot / 2;
    const yT = (v) => MT_PAD_T + ih - v / maxTok * ih;
    const parts = [];
    for (let g = 0; g <= 3; g++) {
      const y = MT_PAD_T + ih - ih * g / 3;
      parts.push(`<line class="gl" x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}"/>`);
      parts.push(`<text class="ax ax-y" x="${PAD_L - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtTok(maxTok * g / 3)}</text>`);
    }
    parts.push(`<line class="baseline" x1="${PAD_L}" y1="${MT_PAD_T + ih}" x2="${W - PAD_R}" y2="${MT_PAD_T + ih}"/>`);
    const step = n <= 7 ? 1 : Math.max(1, Math.round(n / 7));
    rows.forEach((r, i) => {
      if (i % step === 0 || i === n - 1)
        parts.push(`<text class="ax ax-x" x="${x(i).toFixed(1)}" y="${MT_H - 5}" text-anchor="middle">${r.label}</text>`);
    });
    series.forEach((s) => {
      const d = smooth(rows.map((_, i) => [x(i), yT(s.vals[i])]));
      parts.push(`<path class="ln ln-m" style="stroke:${s.color};stroke-dasharray:${s.dash}" d="${d}"/>`);
      const mx = Math.max(...s.vals);
      const key = /* @__PURE__ */ new Set([0, n - 1]);
      s.vals.forEach((v, i) => {
        if (v === mx && v > 0) key.add(i);
      });
      key.forEach((i) => {
        if (s.vals[i] === 0) return;
        parts.push(`<circle class="node" data-i="${i}" cx="${x(i).toFixed(1)}" cy="${yT(s.vals[i]).toFixed(1)}" r="3.2" fill="${s.color}"/>`);
      });
    });
    rows.forEach((_, i) => {
      parts.push(`<rect class="hit" data-i="${i}" x="${(PAD_L + slot * i).toFixed(1)}" y="${MT_PAD_T}" width="${slot.toFixed(1)}" height="${ih.toFixed(1)}"/>`);
    });
    const show = (e) => {
      const i = e.currentTarget.getAttribute("data-i");
      if (i == null) return;
      const row = rows[Number(i)];
      if (!row || !wrapRef.current) return;
      const wb = wrapRef.current.getBoundingClientRect();
      const cx = e.currentTarget.getBoundingClientRect();
      const list = series.map((s) => ({ modelRef: s.modelRef, name: s.name, dash: s.dash, input: s.vals[Number(i)] ?? 0, output: s.out[Number(i)] ?? 0 })).filter((r) => r.input > 0 || r.output > 0).sort((a, b) => b.input - a.input);
      props.onTip({ x: cx.left + cx.width / 2 - wb.left, day: row.day, rows: list, total: row.inputTokens });
    };
    return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "trend-wrap", ref: wrapRef, children: /* @__PURE__ */ jsxRuntime.jsx(
      "svg",
      {
        className: "trend mt",
        viewBox: `0 0 ${W} ${MT_H}`,
        preserveAspectRatio: "none",
        dangerouslySetInnerHTML: { __html: parts.join("") },
        onMouseOver: (e) => {
          console.debug("[usage-tip:mt]", e.type, e.target.tagName);
          show(e);
        },
        onMouseEnter: show,
        onMouseOut: (e) => {
          if (!(e.relatedTarget instanceof Element && e.currentTarget.contains(e.relatedTarget))) props.onTip(null);
        },
        onMouseLeave: () => props.onTip(null)
      }
    ) });
  }
  function stateBadge(state) {
    const s = state.toLowerCase();
    if (/fail|error|abort|cancel/.test(s)) return "err";
    if (/run|pend|queu|work/.test(s)) return "run";
    if (/comp|done|finish|success/.test(s)) return "done";
    return "";
  }
  const TASK_LIMIT = 100;
  function UsageTable(props) {
    const [filter, setFilter] = react.useState("all");
    const [sortKey, setSortKey] = react.useState("lastActiveAt");
    const [desc, setDesc] = react.useState(true);
    const shown = react.useMemo(() => {
      let rows = props.rows;
      if (filter === "priced") rows = rows.filter((r) => r.cost !== null);
      else if (filter === "failed") rows = rows.filter((r) => stateBadge(r.state) === "err");
      const mul = desc ? -1 : 1;
      return [...rows].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (sortKey === "title") return String(av).localeCompare(String(bv)) * mul;
        if (sortKey === "lastActiveAt") return String(av ?? "").localeCompare(String(bv ?? "")) * mul;
        return (Number(av ?? 0) - Number(bv ?? 0)) * mul;
      }).slice(0, TASK_LIMIT);
    }, [props.rows, filter, sortKey, desc]);
    const stats = react.useMemo(() => {
      let cost = null, turns = 0, failCost = null, failed = 0, maxCost = null;
      for (const r of props.rows) {
        turns += r.turns;
        if (r.cost !== null) {
          cost = (cost ?? 0) + r.cost;
          maxCost = maxCost === null ? r.cost : Math.max(maxCost, r.cost);
          if (stateBadge(r.state) === "err") {
            failCost = (failCost ?? 0) + r.cost;
            failed++;
          }
        }
      }
      return { cost, turns, failCost, failed, maxCost };
    }, [props.rows]);
    const th = (key, label, right) => /* @__PURE__ */ jsxRuntime.jsxs("th", { className: right ? "r" : "", onClick: () => {
      if (sortKey === key) setDesc(!desc);
      else {
        setSortKey(key);
        setDesc(true);
      }
    }, children: [
      label,
      sortKey === key && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "srt", children: desc ? "▼" : "▲" })
    ] });
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "usage-card", children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "sumrow", children: [
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "kv", children: t("Usage_TaskCount", props.rows.length) }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sep" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "kv", children: t("Usage_TotalCost", fmtCost(stats.cost)) }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sep" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "kv", children: t("Usage_MostExpensive", fmtCost(stats.maxCost)) }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sep" }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "kv", children: t("Usage_AvgTurns", props.rows.length ? Math.round(stats.turns / props.rows.length) : 0) }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
        stats.failed > 0 && stats.failCost !== null && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "kv warn", children: t("Usage_FailedCost", stats.failed, fmtCost(stats.failCost)) })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "usage-filters", children: ["all", "priced", "failed"].map((f) => /* @__PURE__ */ jsxRuntime.jsx("span", { className: "seg-sg" + (filter === f ? " on" : ""), onClick: () => setFilter(f), children: t(f === "all" ? "Usage_Filter_All" : f === "priced" ? "Usage_Filter_Priced" : "Usage_Filter_Failed") }, f)) }),
      /* @__PURE__ */ jsxRuntime.jsxs("table", { className: "usage-tbl", children: [
        /* @__PURE__ */ jsxRuntime.jsx("thead", { children: /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
          th("title", t("Usage-Col_Task"), false),
          /* @__PURE__ */ jsxRuntime.jsx("th", { children: t("Usage-Col_Model") }),
          /* @__PURE__ */ jsxRuntime.jsx("th", { className: "st", children: t("Usage-Col_State") }),
          th("turns", t("Usage-Col_Turns"), true),
          th("inputTokens", t("Usage-Col_Input"), true),
          th("outputTokens", t("Usage-Col_Output"), true),
          /* @__PURE__ */ jsxRuntime.jsx("th", { className: "r", children: t("Usage-Col_Cache") }),
          th("cost", t("Usage-Col_Cost"), true),
          th("lastActiveAt", t("Usage-Col_When"), true)
        ] }) }),
        /* @__PURE__ */ jsxRuntime.jsxs("tbody", { children: [
          shown.map((r) => {
            const st = stateBadge(r.state);
            return /* @__PURE__ */ jsxRuntime.jsxs("tr", { title: r.title, onClick: () => props.onOpen(r.taskId), children: [
              /* @__PURE__ */ jsxRuntime.jsx("td", { className: "ti", children: r.title }),
              /* @__PURE__ */ jsxRuntime.jsxs("td", { className: "sp", title: r.modelRef ?? "", children: [
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mdot", style: { background: MODEL_DOT(r.modelRef ?? "") } }),
                r.modelRef ? modelName(props.names, r.modelRef) : "—"
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("td", { className: "st", children: /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "badge" + (st ? " " + st : ""), children: [
                /* @__PURE__ */ jsxRuntime.jsx("i", { className: "d" }),
                r.state
              ] }) }),
              /* @__PURE__ */ jsxRuntime.jsx("td", { className: "num", children: r.turns }),
              /* @__PURE__ */ jsxRuntime.jsx("td", { className: "num", children: fmtTok(r.inputTokens) }),
              /* @__PURE__ */ jsxRuntime.jsx("td", { className: "num", children: fmtTok(r.outputTokens) }),
              /* @__PURE__ */ jsxRuntime.jsx("td", { className: "num" + (r.cacheReadTokens === 0 ? " na" : ""), children: fmtTok(r.cacheReadTokens) }),
              /* @__PURE__ */ jsxRuntime.jsx("td", { className: "num" + (r.cost === null ? " na" : ""), children: fmtCost(r.cost) }),
              /* @__PURE__ */ jsxRuntime.jsx("td", { className: "num dim", children: fmtAgo(r.lastActiveAt) })
            ] }, r.taskId);
          }),
          shown.length === 0 && /* @__PURE__ */ jsxRuntime.jsx("tr", { children: /* @__PURE__ */ jsxRuntime.jsx("td", { colSpan: 9, className: "empty-cell", children: t("Usage_NoTaskRows") }) })
        ] })
      ] }),
      props.rows.length > TASK_LIMIT && /* @__PURE__ */ jsxRuntime.jsx("div", { className: "usage-more", children: t("Usage_MoreCollapsed", props.rows.length - TASK_LIMIT) }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "usage-note", children: t("Usage_Foot_Task") })
    ] });
  }
  function ModelList(props) {
    const rows = props.rep.byModel;
    const totIn = Math.max(1, rows.reduce((a, m) => a + m.inputTokens, 0));
    if (rows.length === 0) return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-cell", children: t("Usage_NoModelRows") });
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { children: [
      rows.map((m, i) => {
        const pct = m.inputTokens / totIn * 100;
        const fill = m.inputTokens > 0 ? m.cacheReadTokens / m.inputTokens * 100 : 0;
        return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "usage-mrow", title: m.modelRef, children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "rk", children: i + 1 }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "body", children: [
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "nm", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mdot", style: { background: MODEL_DOT(m.modelRef) } }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "mn", children: modelName(props.rep.modelNames, m.modelRef) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "full", children: m.modelRef })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "mbar", children: [
              /* @__PURE__ */ jsxRuntime.jsx("i", { style: { width: `${pct.toFixed(1)}%` } }),
              fill > 0 && /* @__PURE__ */ jsxRuntime.jsx("i", { className: "on", style: { width: `${fill.toFixed(1)}%` } })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "mnum", children: [
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v", children: fmtTok(m.inputTokens) }),
            /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "p", children: [
              pct.toFixed(1),
              "% · ",
              m.cost === null ? t("Usage_NoCost") : fmtCost(m.cost)
            ] })
          ] })
        ] }, m.modelRef);
      }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "usage-note", children: t("Usage_Foot_Model") })
    ] });
  }
  const RANGES = [
    { d: 7, key: "Usage_Range_7" },
    { d: 30, key: "Usage_Range_30" },
    { d: 90, key: "Usage_Range_90" },
    { d: 0, key: "Usage_Range_All" }
  ];
  const ICON_USAGE = "M2 13.25h12v1.25H2v-1.25ZM3.25 8.5H5v3.25H3.25V8.5Zm4-4H9v7.25H7.25V4.5Zm4 2H13v5.25h-1.75V6.5Z";
  function UsagePage() {
    const [rep, setRep] = react.useState(null);
    const [err, setErr] = react.useState(null);
    const [allProjects, setAllProjects] = react.useState(false);
    const [range, setRange] = react.useState(30);
    const [view, setView] = react.useState("overview");
    const [vis, setVis] = react.useState({ input: true, cache: true, output: true, cost: true });
    const [tip, setTip] = react.useState(null);
    const [mTip, setMTip] = react.useState(null);
    const [spinning, setSpinning] = react.useState(false);
    const tipBoxRef = react.useRef(null);
    const mtBoxRef = react.useRef(null);
    const info = repo();
    const reload = react.useCallback((all) => {
      setSpinning(true);
      void call("agent.usage.report", { allProjects: all }).then((r) => {
        setRep(r);
        setErr(null);
      }).catch((e) => setErr(e.message)).finally(() => setSpinning(false));
    }, []);
    react.useEffect(() => reload(allProjects), [reload, allProjects]);
    const w = react.useMemo(() => rep ? windowOf(rep, range) : null, [rep, range]);
    const cur = w ? sumWindow(w.cur) : null;
    const prev = w && w.prev.length ? sumWindow(w.prev) : null;
    const hitRate = cur && cur.input > 0 ? cur.cache / cur.input : 0;
    if (err) {
      return /* @__PURE__ */ jsxRuntime.jsx("div", { className: "page usage-page", children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "usage-scroll", children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "usage-card", children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-cell err", children: err }) }) }) });
    }
    const onOpenTask = (taskId) => {
      try {
        focusTask(taskId);
        navigate("tasks");
      } catch {
      }
    };
    const isEmpty = cur !== null && cur.turns === 0;
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "page usage-page", children: [
      /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "usage-head", children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "ti", children: [
          /* @__PURE__ */ jsxRuntime.jsx(NavIcon, { svg: ICON_USAGE }),
          /* @__PURE__ */ jsxRuntime.jsx("h1", { children: t("Usage_Title") }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "rpc", children: "agent.usage.report" })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "seg", children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "seg-sg" + (view === "overview" ? " on" : ""), onClick: () => setView("overview"), children: t("Usage_View_Overview") }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "seg-sg" + (view === "tasks" ? " on" : ""), onClick: () => setView("tasks"), children: t("Usage_View_Tasks") })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "scope", onClick: () => setAllProjects(!allProjects), title: t("Usage_Scope_Hint"), children: [
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm", children: info ? info.name : "—" }),
          /* @__PURE__ */ jsxRuntime.jsx("span", { className: "all", children: t(allProjects ? "Usage_Scope_All" : "Usage_Scope_Current") })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("span", { className: "seg", children: RANGES.map((r) => /* @__PURE__ */ jsxRuntime.jsx("span", { className: "seg-sg" + (range === r.d ? " on" : ""), onClick: () => setRange(r.d), children: t(r.key) }, r.d)) }),
        /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn" + (spinning ? " spin" : ""), onClick: () => reload(allProjects), children: t("Usage_Refresh") })
      ] }),
      /* @__PURE__ */ jsxRuntime.jsx("div", { className: "usage-scroll", children: !rep ? /* @__PURE__ */ jsxRuntime.jsx("div", { className: "usage-card", children: /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-cell", children: t("Usage_Loading") }) }) : isEmpty ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "usage-card", children: /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "empty-box", children: [
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "ic", children: t("Usage_Empty_Ic") }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "ttl", children: t("Usage_Empty_Title") }),
          /* @__PURE__ */ jsxRuntime.jsx("div", { className: "sub", children: t("Usage_Empty_Sub") }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "acts", children: [
            /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn solid", onClick: () => navigate("tasks"), children: t("Usage_Empty_Cta") }),
            !allProjects && /* @__PURE__ */ jsxRuntime.jsx("button", { className: "tool-btn", onClick: () => setAllProjects(true), children: t("Usage_Empty_All") })
          ] })
        ] }) }),
        rep.repoPaths.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "usage-card", style: { marginTop: 12 }, children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-hd", children: [
            /* @__PURE__ */ jsxRuntime.jsx("h3", { children: t("Usage_Scan_Title") }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "note", children: t("Usage_Scan_Note") })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("table", { className: "usage-tbl", children: [
            /* @__PURE__ */ jsxRuntime.jsx("thead", { children: /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
              /* @__PURE__ */ jsxRuntime.jsx("th", { children: t("Usage_Scan_Repo") }),
              /* @__PURE__ */ jsxRuntime.jsx("th", { className: "st", children: t("Usage_Scan_Status") })
            ] }) }),
            /* @__PURE__ */ jsxRuntime.jsx("tbody", { children: rep.repoPaths.map((p) => {
              const empty = rep.emptyRepos.includes(p);
              return /* @__PURE__ */ jsxRuntime.jsxs("tr", { children: [
                /* @__PURE__ */ jsxRuntime.jsx("td", { className: "sp", title: p, children: p }),
                /* @__PURE__ */ jsxRuntime.jsx("td", { className: "st", children: /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "badge" + (empty ? " warn" : " done"), children: [
                  /* @__PURE__ */ jsxRuntime.jsx("i", { className: "d" }),
                  empty ? t("Usage_Empty_Ledger") : t("Usage_Has_Ledger")
                ] }) })
              ] }, p);
            }) })
          ] })
        ] })
      ] }) : view === "tasks" ? /* @__PURE__ */ jsxRuntime.jsx(UsageTable, { rows: rep.byTask, names: rep.modelNames, onOpen: onOpenTask }) : /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "kpi-row", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "kpi", children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lbl", children: t("Usage_Kpi_Cost") }),
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "val" + (cur.cost === null ? " na" : ""), children: cur.cost === null ? "—" : fmtCost(cur.cost) }),
            prev && prev.cost !== null && cur.cost !== null ? trendOf(cur.cost, prev.cost) && (() => {
              const tr = trendOf(cur.cost, prev.cost);
              return /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "meta", children: [
                /* @__PURE__ */ jsxRuntime.jsxs("span", { className: tr.dir === "up" ? "up" : "dn", children: [
                  tr.dir === "up" ? "▲" : "▼",
                  " ",
                  tr.pct,
                  "%"
                ] }),
                /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Usage_Meta_Prev", fmtCost(prev.cost)) })
              ] });
            })() : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "meta", children: t("Usage_NoPrice") })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "kpi", children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lbl", children: t("Usage_Kpi_Input") }),
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "val", children: fmtTok(cur.input) }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "meta", children: [
              /* @__PURE__ */ jsxRuntime.jsx("b", { children: cur.turns.toLocaleString() }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "u-lbl", children: t("Usage_Kpi_Turns") }),
              prev && prev.input > 0 && (() => {
                const tr = trendOf(cur.input, prev.input);
                return tr ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: tr.dir === "up" ? "up" : "dn", children: [
                  tr.dir === "up" ? "▲" : "▼",
                  " ",
                  tr.pct,
                  "%"
                ] }) : null;
              })()
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "kpi", children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lbl", children: t("Usage_Kpi_Output") }),
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "val", children: fmtTok(cur.output) }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "meta", children: [
              /* @__PURE__ */ jsxRuntime.jsx("b", { children: cur.turns > 0 ? fmtTok(Math.round(cur.output / cur.turns)) : "—" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "u-lbl", children: t("Usage_Kpi_PerTurn") }),
              prev && prev.output > 0 && cur.turns > 0 && (() => {
                const pt = prev.turns > 0 ? prev.output / prev.turns : 0;
                const tr = trendOf(cur.output / cur.turns, pt);
                return tr ? /* @__PURE__ */ jsxRuntime.jsxs("span", { className: tr.dir === "up" ? "up" : "dn", children: [
                  tr.dir === "up" ? "▲" : "▼",
                  " ",
                  tr.pct,
                  "%"
                ] }) : null;
              })()
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "kpi", children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lbl", children: t("Usage_Kpi_Cache") }),
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "val", children: fmtTok(cur.cache) }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "meta", children: [
              /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                Math.round(hitRate * 100),
                "%"
              ] }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "u-lbl", children: t("Usage_Kpi_HitRate") }),
              rep.cacheBreaks > 0 && /* @__PURE__ */ jsxRuntime.jsx("span", { className: "warn", children: t("Usage_Kpi_Breaks", rep.cacheBreaks) })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "kpi", children: [
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "lbl", children: t("Usage_Kpi_Scale") }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "val", children: [
              rep.byTask.length,
              /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "u", children: [
                "/ ",
                rep.byModel.length
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "meta", children: [
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Usage_Kpi_Repos", rep.repoPaths.length) }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sep2" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { children: rep.emptyRepos.length ? t("Usage_Kpi_Empty", rep.emptyRepos.length) : t("Usage_Kpi_NoEmpty") })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "grid-2a", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "usage-card", children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-hd", children: [
              /* @__PURE__ */ jsxRuntime.jsx("h3", { children: t("Usage_Trend_Title") }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "note", children: t("Usage_Trend_Note") }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "note", children: t("Usage_Trend_Total", w.cur.length, cur.cost === null ? "—" : fmtCost(cur.cost)) })
            ] }),
            w.cur.length ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
              /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "trend-box", ref: tipBoxRef, children: [
                /* @__PURE__ */ jsxRuntime.jsx(TrendChart, { rows: w.cur, vis, models: rep.byDayModel, onTip: setTip }),
                tip && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "usage-tip", style: { left: clampTip(tip.x, tipBoxRef) }, children: [
                  /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tp-h", children: tip.row.day }),
                  /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tp-r", children: [
                    /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Usage_Tip_Turns") }),
                    /* @__PURE__ */ jsxRuntime.jsx("b", { children: tip.row.turns.toLocaleString() })
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tp-r", children: [
                    /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Usage_Tip_Input") }),
                    /* @__PURE__ */ jsxRuntime.jsx("b", { children: fmtTok(tip.row.inputTokens) })
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tp-r", children: [
                    /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Usage_Tip_Output") }),
                    /* @__PURE__ */ jsxRuntime.jsx("b", { children: fmtTok(tip.row.outputTokens) })
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tp-r", children: [
                    /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Usage_Tip_Cache") }),
                    /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                      fmtTok(tip.row.cacheReadTokens),
                      " · ",
                      Math.round(tip.row.cacheRate * 100),
                      "%"
                    ] })
                  ] }),
                  /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tp-r tp-cost", children: [
                    /* @__PURE__ */ jsxRuntime.jsx("span", { children: t("Usage_Tip_Cost") }),
                    /* @__PURE__ */ jsxRuntime.jsx("b", { children: fmtCost(tip.row.cost) })
                  ] }),
                  tip.models.length > 0 && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tp-models", children: [
                    /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tp-m-h", children: t("Usage_Tip_Model_Title") }),
                    tip.models.map((m) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tp-m-r", children: [
                      /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tp-m-nm", style: { "--md": MODEL_DOT(m.modelRef) }, children: modelName(rep.modelNames, m.modelRef) }),
                      /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                        fmtTok(m.inputTokens),
                        /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "u", children: [
                          "· ",
                          fmtTok(m.outputTokens)
                        ] })
                      ] })
                    ] }, m.modelRef))
                  ] })
                ] })
              ] }),
              /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "trend-metric", children: [
                [["input", "Usage_M_Input"], ["cache", "Usage_M_Cache"], ["output", "Usage_M_Output"]].map(([k, labelKey]) => /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "m" + (vis[k] ? " on" : " off"), onClick: () => setVis({ ...vis, [k]: !vis[k] }), children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sw " + k }),
                  t(labelKey)
                ] }, k)),
                /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sep" }),
                /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "m" + (vis.cost ? " on" : " off"), onClick: () => setVis({ ...vis, cost: !vis.cost }), children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sw cost" }),
                  t("Usage_M_Cost")
                ] })
              ] })
            ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-cell", children: t("Usage_NoDayRows") })
          ] }),
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "usage-card", children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-hd", children: [
              /* @__PURE__ */ jsxRuntime.jsx("h3", { children: t("Usage_Model_Title") }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
              /* @__PURE__ */ jsxRuntime.jsx("span", { className: "note", children: t("Usage_Model_Scope") })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx(ModelList, { rep })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "usage-card", children: [
          /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "card-hd", children: [
            /* @__PURE__ */ jsxRuntime.jsx("h3", { children: t("Usage_Trend_Model_Title") }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "note", children: t("Usage_Trend_Model_Note") }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "grow" }),
            /* @__PURE__ */ jsxRuntime.jsx("span", { className: "note", children: t("Usage_Trend_Model_Limit", MAX_MODELS) })
          ] }),
          w.cur.length && rep.byModel.length ? /* @__PURE__ */ jsxRuntime.jsxs(jsxRuntime.Fragment, { children: [
            /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "trend-box", ref: mtBoxRef, children: [
              /* @__PURE__ */ jsxRuntime.jsx(ModelTrendChart, { rows: w.cur, byDayModel: rep.byDayModel, models: rep.byModel, modelNames: rep.modelNames, onTip: setMTip }),
              mTip && /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "usage-tip", style: { left: clampTip(mTip.x, mtBoxRef) }, children: [
                /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tp-h", children: mTip.day }),
                mTip.rows.length ? mTip.rows.map((r) => /* @__PURE__ */ jsxRuntime.jsxs("div", { className: "tp-m-r", children: [
                  /* @__PURE__ */ jsxRuntime.jsx("span", { className: "tp-m-nm", style: { "--md": MODEL_DOT(r.modelRef) }, children: r.name }),
                  /* @__PURE__ */ jsxRuntime.jsxs("b", { children: [
                    fmtTok(r.input),
                    /* @__PURE__ */ jsxRuntime.jsxs("span", { className: "u", children: [
                      "· ",
                      fmtTok(r.output)
                    ] })
                  ] })
                ] }, r.modelRef)) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "tp-empty", children: t("Usage_Tip_NoUsage") })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntime.jsx("div", { className: "trend-model", children: rep.byModel.map((m, mi) => {
              const on = mi < MAX_MODELS;
              return /* @__PURE__ */ jsxRuntime.jsxs(
                "span",
                {
                  className: "m" + (on ? " on" : " off"),
                  title: `${m.modelRef}
${t("Usage_Trend_ByModelHint", fmtTok(m.inputTokens))}`,
                  children: [
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "sw", style: { background: MODEL_DOT(m.modelRef), "--mdash": MODEL_DASH_OF(m.modelRef) } }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "nm", children: modelName(rep.modelNames, m.modelRef) }),
                    /* @__PURE__ */ jsxRuntime.jsx("span", { className: "v", children: fmtTok(m.inputTokens) })
                  ]
                },
                m.modelRef
              );
            }) })
          ] }) : /* @__PURE__ */ jsxRuntime.jsx("div", { className: "empty-cell", children: t("Usage_NoDayRows") })
        ] }),
        /* @__PURE__ */ jsxRuntime.jsx("div", { className: "usage-note", children: t("Usage_Foot_Cost") })
      ] }) })
    ] });
  }
  window.GITTER_UI.registerPage({ id: "usage" }, (container) => {
    var _a2;
    const host = container;
    (_a2 = host.__gitterRoot) == null ? void 0 : _a2.unmount();
    const root = ReactDOMClient.createRoot(container);
    root.render(
      React.createElement(PageErrorBoundary, {
        pageKey: "usage",
        children: React.createElement(UsagePage)
      })
    );
    host.__gitterRoot = root;
    return () => {
      host.__gitterRoot = void 0;
      root.unmount();
    };
  });
})(window.GITTER_KIT.ReactJSXRuntime, window.GITTER_KIT.React);
