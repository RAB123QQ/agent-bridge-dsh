// pair-panel client bundle v5.3: native dual peer panels plus a persistent header switch. v5.3 preserves feed scroll positions across polling layout work.
window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-client-ui-pair-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		var POLL_MS = 2500;
		var ENABLED_KEY = "dsh-pair-panel-enabled";

		var runtime = { dsh: null, snapshot: null, error: null, panel: null, cardsBox: null, handle: null, cards: {}, launches: {}, listeners: [], enabled: true, pairSel: "", sessionId: "", disposed: false };
		try { runtime.enabled = window.localStorage.getItem(ENABLED_KEY) !== "0"; } catch (error) {}

		var CSS = `
/* dsh code-block language banner (bash tile) uses position:sticky z-index:6,
   which floats above the settings panel (z-index:1). Pin it below overlays. */
.md-code-block [class*='bannerWrap'] { z-index: 0 !important; }
/* Root cause (per codex analysis): the settings overlay is portaled under the
   sidebar footer, and the skin's sidebar stacking helper traps it in a local
   z-index:2 context, so its z-index:1000 never escapes. Un-trap that chain. */
body[data-dsh-maid-atelier] :is([data-pane='sidebar'], [class*='sidebarCol']) > div > [data-maid-sidebar-footer] {
  z-index: auto !important;
  isolation: auto !important;
  transform: none !important;
  filter: none !important;
}
/* Docked right peer rail — same visual language as the left sidebar:
   flat surface, thin divider, full height, no floating card/shadow. */
.pp-panels {
  position:fixed;
  /* Flush to the top like the left sidebar: the conversation column already
     reserves the rail width, so the rail fills the full height instead of
     leaving an empty strip above it. */
  top:var(--dsh-windows-titlebar-height,0px);
  right:0;
  bottom:0;
  width:clamp(300px, 26vw, 420px);
  display:none;
  flex-direction:column;
  background:var(--dsw-alias-bg-layer-1);
  border-left:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
  font:13px/1.5 ui-sans-serif,system-ui,'PingFang SC','Microsoft YaHei',sans-serif;
  z-index:2;
  pointer-events:auto;
}
body[data-pair-panel-mode='abg'] .pp-panels { display:flex; }
.pp-card { flex:1 1 0; min-width:0; min-height:0; display:flex; flex-direction:column; background:transparent; border:0; border-radius:0; box-shadow:none; overflow:hidden; }
.pp-card + .pp-card { border-top:1px solid var(--dsw-alias-border-l1); }
.pp-toggle { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; padding:0; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); font:12px/1 ui-sans-serif,system-ui,sans-serif; cursor:pointer; flex:none; margin-left:2px; }
.pp-toggle[aria-checked='true'] { color:var(--dsw-alias-label-primary); }
.pp-toggle:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.pp-toggle-dot { width:7px; height:7px; border-radius:50%; background:var(--dsw-alias-label-tertiary); }
.pp-actions { margin-left:auto; display:flex; align-items:center; gap:2px; flex:none; }
.pp-launch { min-width:0; height:24px; display:inline-flex; align-items:center; justify-content:center; gap:4px; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); font:12px/1 ui-sans-serif,system-ui,sans-serif; padding:0 6px; cursor:pointer; flex:none; transition:background .15s ease,color .15s ease; }
.pp-launch:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.pp-launch:disabled { cursor:default; opacity:.6; }
.pp-launch.starting { color:var(--dsw-alias-state-warn-primary); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); cursor:progress; }
.pp-launch.success { color:var(--dsw-alias-state-success-primary); background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.pp-launch.error { color:var(--dsw-alias-state-error-primary); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.pp-launch-new { margin-left:0; min-width:24px; padding:0 6px; }
.pp-launch-new:disabled { opacity:.4; cursor:default; }
.pp-launch.starting .pp-launch-icon { animation:pp-spin .9s linear infinite; }
@keyframes pp-spin { to { transform:rotate(360deg); } }
.pp-toggle[aria-checked='true'] .pp-toggle-dot { background:var(--dsw-alias-state-success-primary); box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success-primary) 25%, transparent); }
.pp-head { display:flex; align-items:center; gap:6px; padding:10px 12px 6px; flex:none; background:transparent; border-bottom:0; }
.pp-title { font-weight:600; color:var(--dsw-alias-label-primary); letter-spacing:0; font-size:13px; flex:none; }
.pp-sub { color:var(--dsw-alias-label-tertiary); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.pp-chip { padding:0 6px; border-radius:4px; font-size:10px; flex:none; border:0; color:var(--dsw-alias-label-tertiary); background:transparent; }
.pp-chip.running { color:var(--dsw-alias-state-success-primary); background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); animation:pp-pulse 1.6s ease-in-out infinite; }
@keyframes pp-pulse { 0%,100%{opacity:1} 50%{opacity:.55} }
.pp-ctx { flex:none; padding:2px 12px 8px; border-bottom:0; display:flex; flex-direction:column; gap:5px; background:transparent; }
.pp-gauge { display:flex; flex-direction:column; gap:2px; }
.pp-gauge-row { display:flex; justify-content:space-between; gap:12px; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.pp-gauge-row b { color:var(--dsw-alias-label-secondary); font-weight:500; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; max-width:72%; }
.pp-bar { height:4px; border-radius:2px; background:var(--dsw-alias-border-l1); overflow:hidden; }
.pp-bar>i { display:block; height:100%; border-radius:2px; background:var(--dsw-alias-brand-primary); transition:width .4s ease; }
.pp-bar>i.warn { background:var(--dsw-alias-state-warn-primary); }
.pp-feed { flex:1; min-height:0; overflow-y:auto; overflow-anchor:none; padding:4px 8px 10px; display:flex; flex-direction:column; gap:2px; background:transparent; scrollbar-width:thin; scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent; }
.pp-feed > * { flex:none; } /* flex column would squash rows instead of overflowing; pin their height so the feed really scrolls */
.pp-msg { border-radius:6px; padding:5px 8px; max-width:none; white-space:pre-wrap; word-break:break-word; font-size:12px; }
.pp-msg.user { align-self:stretch; background:var(--dsw-alias-interactive-bg-hover); border:0; }
.pp-msg.assistant { align-self:stretch; background:transparent; border:0; color:var(--dsw-alias-label-primary); }
.pp-tool { align-self:stretch; font:11px/1.5 ui-monospace,monospace; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); border:0; border-radius:6px; padding:4px 8px; max-width:100%; word-break:break-all; }
.pp-task { align-self:stretch; color:var(--dsw-alias-label-tertiary); font-size:11px; padding:2px 8px; }
.pp-time { color:var(--dsw-alias-label-tertiary); font-size:10px; margin-left:6px; }
.pp-empty { color:var(--dsw-alias-label-tertiary); font-size:12px; text-align:center; padding:24px 12px; }
@media (max-width:1180px) {
  .pp-sub { display:none; }
  .pp-chip { display:none; }
  .pp-launch { font-size:11px; padding:0 4px; }
}
@media (max-width:1000px) {
  .pp-panels { width:280px; }
  .pp-head { padding:8px 10px 4px; gap:4px; }
  .pp-ctx { padding:0 10px 6px; }
  .pp-feed { padding:2px 6px 8px; }
  .pp-foot { padding:6px 10px; }
}
.pp-foot { flex:none; padding:8px 12px; font-size:10px; color:var(--dsw-alias-label-tertiary); border-top:1px solid var(--dsw-alias-border-l1); background:transparent; }
.pp-foot.launch-starting { color:var(--dsw-alias-state-warn-primary); }
.pp-foot.launch-success { color:var(--dsw-alias-state-success-primary); }
.pp-foot.launch-error { color:var(--dsw-alias-state-error-primary); }
.pp-railhead { display:flex; align-items:center; gap:6px; padding:10px 12px 6px; flex:none; }
.pp-railtitle { font-weight:600; font-size:13px; color:var(--dsw-alias-label-primary); }
.pp-cards { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
.pp-md { white-space:normal; }
.pp-md p { margin:0 0 6px; }
.pp-md p:last-child { margin-bottom:0; }
.pp-md h3,.pp-md h4,.pp-md h5,.pp-md h6 { margin:8px 0 4px; font-size:13px; font-weight:600; line-height:1.4; }
.pp-md ul,.pp-md ol { margin:2px 0 6px; padding-left:18px; }
.pp-md li { margin:1px 0; }
.pp-md pre { margin:4px 0 6px; padding:6px 8px; border-radius:6px; background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2)); overflow:auto; font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace; }
.pp-md code { font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace; background:var(--dsw-alias-bg-layer-2); border-radius:4px; padding:1px 4px; }
.pp-md pre code { background:transparent; padding:0; }
.pp-md a { color:var(--dsw-alias-brand-primary); text-decoration:underline; }
.pp-md blockquote { margin:4px 0 6px; padding:2px 8px; border-left:2px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); }
.pp-md hr { border:0; border-top:1px solid var(--dsw-alias-border-l1); margin:8px 0; }
.pp-md strong { font-weight:600; }
`;

		function notify() { for (var i = 0; i < runtime.listeners.length; i++) { try { runtime.listeners[i](); } catch (error) {} } }
		function subscribe(listener) { runtime.listeners.push(listener); return function () { runtime.listeners = runtime.listeners.filter(function (item) { return item !== listener; }); }; }
		function isAbg() { return !!(runtime.snapshot && runtime.snapshot.ok && (runtime.snapshot.mode === "abg" || runtime.snapshot.mode === "plain")); }
		function loadSnapshot() {
			if (runtime.disposed) return;
			// Forward the session id captured from the header slot so the host
			// can resolve the live Session (token meter / context window). DSH
			// 0.2.x routes have no initiator boundary, so without this the host
			// only sees the workspace fallback.
			var sessionQuery = runtime.sessionId ? "&session=" + encodeURIComponent(runtime.sessionId) : "";
			fetch("/pair-panel/snapshot?pair=" + encodeURIComponent(runtime.pairSel || "") + sessionQuery, { cache:"no-store" })
				.then(function (response) { if (!response.ok) throw new Error("snapshot HTTP " + response.status); return response.json(); })
				.then(function (data) { if (runtime.disposed) return; runtime.snapshot = data; runtime.error = null; renderPanel(); notify(); })
				.catch(function (error) { if (runtime.disposed) return; runtime.error = String((error && error.message) || error); renderPanel(); notify(); });
		}

		// The peer rail is docked to the right edge, styled like the left
		// sidebar: one flat full-height column instead of a floating card. The
		// layout pass only reserves its width for the conversation column and
		// steps to the left of the official right sidebar when that is open.
		var LAYOUT_GAP = 0;
		var PANELS_GAP = 8;
		var layoutApplied = false;
		var leftMaidTouched = false;

		// The left maid keeps her skin position; the docked rail does not touch
		// her, so this is only kept for skin-era restore symmetry.
		function adjustLeftMaid() {
			var maid = document.querySelector("[data-maid-character='left']");
			if (!maid) return;
			leftMaidTouched = true;
			maid.style.height = "min(62vh, 800px)";
			maid.style.translate = "";
			maid.style.left = "";
			maid.style.bottom = "";
		}
		function restoreLeftMaid() {
			if (!leftMaidTouched) return;
			leftMaidTouched = false;
			var maid = document.querySelector("[data-maid-character='left']");
			if (!maid) return;
			maid.style.height = "";
			maid.style.translate = "";
			maid.style.left = "";
			maid.style.bottom = "";
		}

		function layoutPanel() {
			if (!isAbg() || !runtime.enabled) { layoutApplied = false; return; }
			var panel = runtime.panel;
			if (!panel) return;
			// DSH 0.2.x lays the app out as a three-column CSS grid with a real
			// right sidebar track ([data-rightbar-col]). When that track is open,
			// dock the rail immediately to its left instead of covering it.
			var rightbarEl = document.querySelector("[data-rightbar-col]");
			var rightbarWidth = 0;
			if (rightbarEl) {
				var rbRect = rightbarEl.getBoundingClientRect();
				if (isFinite(rbRect.width) && rbRect.width > 0) rightbarWidth = rbRect.width;
			}
			var right = rightbarWidth > 0 ? rightbarWidth + "px" : "0px";
			if (panel.style.right !== right) panel.style.right = right;
			// Reserve the rail width inside the conversation column so the
			// composer / chat content is never hidden under it.
			var rect = panel.getBoundingClientRect();
			var railWidth = rect && isFinite(rect.width) && rect.width > 0 ? rect.width : 360;
			var conv = document.querySelector("[class*='centerCol']");
			if (conv && conv.style.marginRight !== railWidth + "px") conv.style.marginRight = railWidth + "px";
			layoutApplied = true;
		}
		function clearLayout() {
			if (layoutApplied) {
				var conv = document.querySelector("[class*='centerCol']");
				if (conv) conv.style.marginRight = "";
				layoutApplied = false;
			}
		}
		function setEnabled(enabled) { runtime.enabled = !!enabled; try { window.localStorage.setItem(ENABLED_KEY, runtime.enabled ? "1" : "0"); } catch (error) {} renderPanel(); notify(); }
		function add(parent, tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text !== undefined && text !== null) node.textContent = String(text); parent.appendChild(node); return node; }
		function fmtNumber(value) { return typeof value === "number" && isFinite(value) ? Math.round(value).toLocaleString() : "–"; }
		function fmtTime(value) { var match = value && String(value).match(/T(\d{2}):(\d{2}):(\d{2})/); return match ? match[1] + ":" + match[2] + ":" + match[3] : ""; }
		function timestamp(parent, value) { var text = fmtTime(value); if (text) add(parent, "span", "pp-time", text); }
		function msgKey(item) { return (item.kind || "event") + "\u0000" + (item.role || "") + "\u0000" + (item.text || "").slice(0, 24); }
		function msgFull(item) { return (item.kind || "event") + "\u0000" + (item.role || "") + "\u0000" + (item.text || ""); }
		function rowText(item) {
			if (item.kind === "message") return item.text || "";
			if (item.kind === "tool") return "tool: " + (item.name || "unknown") + (item.text ? " " + item.text : "");
			if (item.kind === "tool-out") return "result: " + (item.text || "");
			return (item.text || item.kind || "event") + (item.ts ? " · " + fmtTime(item.ts) : "");
		}
		// Lightweight, dependency-free markdown rendering for peer messages.
		// Everything is built as DOM nodes so peer text cannot inject markup.
		// Supported: fenced code, headings, lists, blockquote, hr, inline code,
		// bold/italic/strike, links, and hard line breaks.
		function mdInline(target, text) {
			var re = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|~~[^~]+~~|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
			var last = 0, m;
			while ((m = re.exec(text))) {
				if (m.index > last) target.appendChild(document.createTextNode(text.slice(last, m.index)));
				var tok = m[0], el;
				if (tok.charAt(0) === "`") { el = document.createElement("code"); el.textContent = tok.slice(1, -1); }
				else if (tok.indexOf("**") === 0 || tok.indexOf("__") === 0) { el = document.createElement("strong"); el.textContent = tok.slice(2, -2); }
				else if (tok.indexOf("~~") === 0) { el = document.createElement("del"); el.textContent = tok.slice(2, -2); }
				else if (tok.charAt(0) === "[") {
					var link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok);
					el = document.createElement("a"); el.textContent = link[1]; el.href = link[2]; el.target = "_blank"; el.rel = "noopener noreferrer";
				}
				else { el = document.createElement("em"); el.textContent = tok.slice(1, -1); }
				target.appendChild(el);
				last = m.index + tok.length;
			}
			if (last < text.length) target.appendChild(document.createTextNode(text.slice(last)));
		}
		function mdTextBlock(target, lines) {
			for (var i = 0; i < lines.length; i++) {
				if (i > 0) target.appendChild(document.createElement("br"));
				mdInline(target, lines[i]);
			}
		}
		function renderMarkdown(root, text) {
			root.replaceChildren();
			var lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
			var i = 0;
			while (i < lines.length) {
				var line = lines[i];
				var fence = /^\s*```([\w+#.-]*)\s*$/.exec(line);
				if (fence) {
					i++;
					var codeLines = [];
					while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i++; }
					if (i < lines.length) i++;
					var pre = document.createElement("pre");
					var code = document.createElement("code");
					code.textContent = codeLines.join("\n");
					pre.appendChild(code); root.appendChild(pre); continue;
				}
				if (!line.trim()) { i++; continue; }
				var h = /^(#{1,6})\s+(.*)$/.exec(line);
				if (h) {
					var level = Math.min(6, h[1].length + 2);
					var heading = document.createElement("h" + level);
					mdInline(heading, h[2]);
					root.appendChild(heading); i++; continue;
				}
				if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { root.appendChild(document.createElement("hr")); i++; continue; }
				if (/^\s*>\s?/.test(line)) {
					var bq = document.createElement("blockquote");
					var quoted = [];
					while (i < lines.length && /^\s*>\s?/.test(lines[i])) { quoted.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
					mdTextBlock(bq, quoted); root.appendChild(bq); continue;
				}
				var listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
				if (listMatch) {
					var ordered = /\d/.test(listMatch[2]);
					var list = document.createElement(ordered ? "ol" : "ul");
					while (i < lines.length) {
						var item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
						if (!item) break;
						var li = document.createElement("li");
						mdInline(li, item[3]);
						list.appendChild(li); i++;
					}
					root.appendChild(list); continue;
				}
				var para = [];
				while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>|([-*+]|\d+[.)])\s+)/.test(lines[i])) { para.push(lines[i]); i++; }
				var p = document.createElement("p");
				mdTextBlock(p, para);
				root.appendChild(p);
			}
		}
		function updateItemText(row, item) {
			var span = row.querySelector ? row.querySelector(".pp-text") : null;
			var text = rowText(item);
			if (span) {
				if (span.__ppRaw === text) return;
				span.__ppRaw = text;
				if (item.kind === "message") {
					var shown = text.length > 60000 ? text.slice(0, 60000) + "\n\n…（已截断）" : text;
					try { renderMarkdown(span, shown); } catch (e) { span.textContent = shown; }
				} else span.textContent = text;
			} else if (row.textContent !== text) row.textContent = text;
		}

		function buildFeedItem(item) {
			var row = document.createElement("div");
			if (item.kind === "message") row.className = "pp-msg " + (item.role === "user" ? "user" : "assistant");
			else if (item.kind === "tool" || item.kind === "tool-out") row.className = "pp-tool";
			else row.className = "pp-task";
			var bodyEl = document.createElement(item.kind === "message" ? "div" : "span");
			bodyEl.className = "pp-text" + (item.kind === "message" ? " pp-md" : "");
			if (item.kind === "message") {
				// New rows are built directly (updateFeed only refreshes kept rows
				// when their text grows), so render the markdown here as well.
				var initial = rowText(item);
				var shown = initial.length > 60000 ? initial.slice(0, 60000) + "\n\n…（已截断）" : initial;
				bodyEl.__ppRaw = initial;
				try { renderMarkdown(bodyEl, shown); } catch (error) { bodyEl.textContent = shown; }
			} else bodyEl.textContent = rowText(item);
			row.appendChild(bodyEl);
			timestamp(row, item.ts);
			return row;
		}

		function makeGauge(parent, label) {
			var box = add(parent, "div", "pp-gauge"); var row = add(box, "div", "pp-gauge-row");
			var labelEl = add(row, "span", "", label);
			var valueEl = add(row, "b", "", "");
			var fill = add(add(box, "div", "pp-bar"), "i", "");
			return { labelEl: labelEl, valueEl: valueEl, fill: fill };
		}

		function updateGauge(g, label, used, limit) {
			g.labelEl.textContent = label;
			var valid = typeof used === "number" && typeof limit === "number" && limit > 0;
			var percent = valid ? Math.min(100, Math.max(0, used / limit * 100)) : 0;
			var text = fmtNumber(used);
			if (typeof limit === "number") {
				text += " / " + fmtNumber(limit);
				if (valid) {
					text += " (" + Math.round(percent) + "%)";
					var left = Math.max(0, limit - used);
					if (left > 0) text += " · 剩 " + fmtNumber(left);
				}
			}
			g.valueEl.textContent = text;
			g.fill.className = percent > 90 ? "warn" : "";
			g.fill.style.width = percent + "%";
		}

		function launchLabel(peer) { return peer === "claude" ? "Claude" : "Codex"; }
		function launchCommand(peer) { return peer === "claude" ? "abg claude --safe" : "abg codex"; }
		function getLaunchState(peer, pairName) {
			var key = (pairName || "") + "\u0000" + peer;
			if (!runtime.launches[key]) runtime.launches[key] = { status: "idle", message: "", resetTimer: null, controller: null };
			return runtime.launches[key];
		}
		function updateLaunchButton(state) {
			var ui = state.ui; var launch = state.launch || { status: "idle", message: "" }; var status = launch.status;
			var icon = status === "starting" ? "↻" : status === "success" ? "✓" : status === "error" ? "!" : "▶";
			var text = status === "starting" ? "启动中" : status === "success" ? "已唤起" : status === "error" ? "重试" : "启动";
			ui.launch.className = "pp-launch" + (status === "idle" ? "" : " " + status);
			ui.launch.disabled = status === "starting" || status === "success";
			if (ui.launchNew) ui.launchNew.disabled = status === "starting" || status === "success";
			ui.launchIcon.textContent = icon;
			ui.launchText.textContent = text;
			var base = launchLabel(state.peer) + "（" + launchCommand(state.peer) + "）";
			ui.launch.setAttribute("aria-label", (status === "error" ? "重试启动 " : "启动 ") + base);
			ui.launch.title = status === "starting" ? "正在启动 " + base : status === "success" ? (launch.message || base + " 已唤起") : status === "error" ? (launch.message || "启动失败，点击重试") : "在新终端启动 " + base;
		}
		function refreshLaunchUi(launch) {
			var peers = Object.keys(runtime.cards);
			for (var i = 0; i < peers.length; i++) {
				var state = runtime.cards[peers[i]];
				if (state.launch === launch) {
					updateLaunchButton(state);
					if (runtime.snapshot) updateFoot(state, runtime.snapshot);
				}
			}
		}
		function setLaunchState(launch, status, message) {
			if (launch.resetTimer) { window.clearTimeout(launch.resetTimer); launch.resetTimer = null; }
			launch.status = status; launch.message = message || "";
			refreshLaunchUi(launch);
			if (status === "success" || status === "error") {
				launch.resetTimer = window.setTimeout(function () {
					launch.resetTimer = null; launch.status = "idle"; launch.message = ""; refreshLaunchUi(launch);
				}, status === "success" ? 4500 : 7000);
			}
		}
		function launchSide(state, fresh) {
			fresh = !!fresh;
			// Launch the side on the pair currently selected in the panel (the
			// old hardcoded main/cf names broke for any other pair name).
			var snapPair = runtime.snapshot && runtime.snapshot.pair;
			var pairName = snapPair && snapPair.name ? String(snapPair.name) : (state.peer === "claude" ? "cf" : "main");
			var launch = getLaunchState(state.peer, pairName); state.launch = launch;
			if (launch.status === "starting" || launch.status === "success") return;
			setLaunchState(launch, "starting", "正在启动 " + launchLabel(state.peer) + "…");
			var controller = typeof AbortController === "function" ? new AbortController() : null;
			launch.controller = controller;
			var requestTimer = controller ? window.setTimeout(function () { controller.abort(); }, 15000) : null;
			fetch("/pair-panel/launch", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ side: state.peer, pair: pairName, "new": fresh }),
				signal: controller ? controller.signal : undefined,
			}).then(function (response) {
				return response.text().then(function (text) {
					var data = null; if (text) { try { data = JSON.parse(text); } catch (error) {} }
					var detail = data && typeof data.error === "string" ? data.error : data && typeof data.message === "string" ? data.message : text ? text.slice(0, 160) : "HTTP " + response.status;
					if (!response.ok || (data && data.ok === false)) throw new Error(detail);
					return data || {};
				});
			}).then(function (data) {
				var message = typeof data.message === "string" ? data.message : launchLabel(state.peer) + " 终端已唤起";
				setLaunchState(launch, "success", message);
				loadSnapshot();
			}).catch(function (error) {
				var detail = error && error.name === "AbortError" ? "请求超时" : String((error && error.message) || error);
				setLaunchState(launch, "error", "启动失败：" + detail);
				console.error("pair-panel launch failed:", error);
			}).finally(function () {
				if (requestTimer) window.clearTimeout(requestTimer);
				if (launch.controller === controller) launch.controller = null;
			});
		}

		function buildPanel(peer) {
			var panel = document.createElement("aside");
			panel.className = "pp-card";
			panel.setAttribute("data-peer", peer);
			panel.setAttribute("aria-label", peer === "claude" ? "Claude peer conversation" : "Codex peer conversation");
			runtime.cardsBox.appendChild(panel);
			var state = { peer: peer, panel: panel, ui: {}, feed: null, feedKeys: [], feedItems: [], stickToBottom: true, restoringScroll: false, scrollRestoreToken: 0, launch: null };
			var ui = state.ui;
			var head = ui.head = add(panel, "div", "pp-head");
			ui.title = add(head, "span", "pp-title", "");
			ui.chip = add(head, "span", "pp-chip", "");
			ui.sub = add(head, "span", "pp-sub", "");
			ui.actions = add(head, "div", "pp-actions");
			ui.launch = add(ui.actions, "button", "pp-launch"); ui.launch.type = "button"; ui.launch.setAttribute("aria-live", "polite");
			ui.launchIcon = add(ui.launch, "span", "pp-launch-icon", "▶");
			ui.launchText = add(ui.launch, "span", "pp-launch-text", "启动");
			ui.launch.addEventListener("click", function () { launchSide(state, false); });
			ui.launchNew = add(ui.actions, "button", "pp-launch pp-launch-new", "新");
			ui.launchNew.type = "button";
			ui.launchNew.title = "开新对话（codex 加 --new 开新线程）";
			ui.launchNew.addEventListener("click", function () { launchSide(state, true); });
			var context = add(panel, "div", "pp-ctx");
			ui.gauges = [makeGauge(context, "DSH 会话 context"), makeGauge(context, "")];
			state.feed = add(panel, "div", "pp-feed");
			state.userScrollTop = 0;
			var cancelScrollRestore = function () {
				if (!state.restoringScroll) return;
				state.scrollRestoreToken++;
				state.restoringScroll = false;
			};
			state.feed.addEventListener("wheel", cancelScrollRestore, { passive: true });
			state.feed.addEventListener("touchstart", cancelScrollRestore, { passive: true });
			state.feed.addEventListener("pointerdown", cancelScrollRestore, { passive: true });
			state.feed.addEventListener("scroll", function () {
				if (state.restoringScroll) return;
				state.userScrollTop = state.feed.scrollTop;
				state.stickToBottom = state.feed.scrollHeight - state.feed.scrollTop - state.feed.clientHeight < 48;
			});
			ui.foot = add(panel, "div", "pp-foot", "");
			runtime.cards[peer] = state;
			return state;
		}

		function ensurePanels(peers) {
			var keep = {};
			for (var i = 0; i < peers.length; i++) keep[peers[i]] = true;
			var existing = Object.keys(runtime.cards);
			for (var j = 0; j < existing.length; j++) {
				var oldPeer = existing[j];
				if (!keep[oldPeer]) {
					runtime.cards[oldPeer].panel.remove();
					delete runtime.cards[oldPeer];
				}
			}
			for (var k = 0; k < peers.length; k++) {
				var peer = peers[k];
				var state = runtime.cards[peer] || buildPanel(peer);
				var current = runtime.cardsBox.children[k] || null;
				// Keep the requested order without detaching cards that are already
				// in place; reparenting a scroll container resets its scrollTop.
				if (current !== state.panel) runtime.cardsBox.insertBefore(state.panel, current);
			}
			runtime.cardsBox.className = "pp-cards " + (peers.length === 2 ? "both" : "single");
		}

		function updateHead(state, peer, running, phase, pair, thread, snap, showPairSelector) {
			var ui = state.ui;
			ui.title.textContent = peer === "claude" ? "Claude 对端" : "Codex 对端";
			state.launch = getLaunchState(peer, pair.name || "");
			updateLaunchButton(state);
			ui.chip.textContent = running ? "● 运行中" : (phase || "已连接");
			ui.chip.className = "pp-chip" + (running ? " running" : "");
			ui.sub.textContent = (pair.name ? pair.name + " · " : "") + (thread ? "#" + thread : "") + (pair.status ? " · " + pair.status : "");
			var pairs = snap && Array.isArray(snap.pairs) ? snap.pairs : null;
			if (showPairSelector && pairs && pairs.length > 1) {
				if (!ui.pairSelEl) {
					var sel = add(ui.actions, "select", "pp-pair");
					ui.actions.insertBefore(sel, ui.launch);
					ui.pairSelEl = sel;
					sel.addEventListener("change", function () {
						runtime.pairSel = sel.value;
						try { window.localStorage.setItem("dsh-pair-panel-pair", runtime.pairSel); } catch (error) {}
						loadSnapshot();
					});
				}
				var ps = ui.pairSelEl;
				var optionsKey = pairs.map(function (op) { return String(op.name) + "\u0000" + String(op.peer); }).join("\u0001");
				if (ui.pairOptionsKey !== optionsKey) {
					ps.replaceChildren();
					for (var pi = 0; pi < pairs.length; pi++) {
						var op = pairs[pi];
						var opt = add(ps, "option", "", op.name + (op.peer === "claude" ? " \u00b7 Claude" : op.peer === "both" ? " \u00b7 both" : " \u00b7 Codex"));
						opt.value = op.name;
					}
					ui.pairOptionsKey = optionsKey;
				}
				if (ps.value !== pair.name) ps.value = pair.name || "";
			} else if (ui.pairSelEl) {
				ui.pairSelEl.remove(); ui.pairSelEl = null; ui.pairOptionsKey = null;
			}
		}

		function restoreFeedScroll(state, saved, feedChanged) {
			var feed = state.feed;
			// "Was at the bottom" has to survive one bad frame: a transient
			// clamp (row re-render / image layout) can make the live value false,
			// so also trust the metrics captured before the update.
			var stickToBottom = saved ? saved.stickToBottom : state.stickToBottom;
			if (!stickToBottom && saved && typeof saved.height === 'number' && typeof saved.client === 'number') {
				stickToBottom = saved.height - saved.client - (saved.top || 0) < 48;
			}
			var targetTop = saved ? saved.top : state.userScrollTop;
			var token = ++state.scrollRestoreToken;
			state.restoringScroll = true;
			var settle = function () {
				if (token !== state.scrollRestoreToken || !feed.isConnected) return;
				if (stickToBottom) feed.scrollTop = feed.scrollHeight;
				else feed.scrollTop = Math.min(targetTop || 0, Math.max(0, feed.scrollHeight - feed.clientHeight));
			};
			window.requestAnimationFrame(function () {
				if (token !== state.scrollRestoreToken || !feed.isConnected) return;
				settle();
				// Markdown/code blocks change height after their first layout; run
				// a second pass so a bottom-stuck feed never drifts upward.
				window.requestAnimationFrame(function () {
					if (token !== state.scrollRestoreToken || !feed.isConnected) return;
					settle();
					state.userScrollTop = feed.scrollTop;
					state.stickToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48;
					state.restoringScroll = false;
				});
			});
		}

		function updateContext(state, peer, codexTokens, codexWindow, snap) {
			var ui = state.ui;
			var dshUsed = runtime.dsh ? runtime.dsh.used : null;
			var dshWin = runtime.dsh ? runtime.dsh.window : null;
			var snapDsh = snap && snap.dsh;
			if (dshUsed === null || dshUsed === undefined) dshUsed = snapDsh && typeof snapDsh.pressure === "number" ? snapDsh.pressure : null;
			if (dshWin === null || dshWin === undefined) dshWin = snapDsh && typeof snapDsh.window === "number" ? snapDsh.window : null;
			updateGauge(ui.gauges[0], "DSH 会话 context", dshUsed, dshWin);
			updateGauge(ui.gauges[1], peer === "claude" ? "Claude 对端 context" : "Codex 线程 context", codexTokens, codexWindow);
		}

		function updateFeed(state, feed, peer) {
			var feedBox = state.feed;
			var oldItems = state.feedItems || [];
			var items = [];
			for (var i = 0; i < feed.length; i++) items.push({ item: feed[i], stable: msgKey(feed[i]), full: msgFull(feed[i]) });
			var keys = [];
			for (var c = 0; c < items.length; c++) keys.push(items[c].stable);
			var oldStable = [];
			for (var a = 0; a < oldItems.length; a++) oldStable.push(oldItems[a].stable);
			// Structure diff on stable keys: streaming text growth keeps the
			// same stable key, so only truly new/moved rows rebuild the DOM.
			var pre = 0;
			var maxPre = Math.min(oldStable.length, keys.length);
			while (pre < maxPre && oldStable[pre] === keys[pre]) pre++;
			var suf = 0;
			while (suf < maxPre - pre && oldStable[oldStable.length - 1 - suf] === keys[keys.length - 1 - suf]) suf++;
			var oldStart = pre;
			var oldEnd = oldStable.length - suf;
			var newStart = pre;
			var newEnd = keys.length - suf;
			var changed = false;
			// In-place text refresh on kept rows (streaming messages grow in
			// place; updating textContent does not disturb the scroll offset).
			for (var u = 0; u < pre; u++) {
				if (oldItems[u].full !== items[u].full) { updateItemText(feedBox.children[u], items[u].item); oldItems[u] = items[u]; changed = true; }
			}
			for (var v = keys.length - suf; v < keys.length; v++) {
				var oldIdx = oldItems.length - keys.length + v;
				if (oldIdx >= 0 && oldIdx < oldItems.length && oldItems[oldIdx].full !== items[v].full) { updateItemText(feedBox.children[oldIdx], items[v].item); oldItems[oldIdx] = items[v]; changed = true; }
			}
			// Rebuild only the changed middle.
			while (oldEnd > oldStart) {
				feedBox.removeChild(feedBox.children[oldStart]);
				oldItems.splice(oldStart, 1);
				oldEnd--;
			}
			for (var j = newStart; j < newEnd; j++) {
				var node = buildFeedItem(items[j].item);
				var at = oldStart + (j - newStart);
				if (at < feedBox.children.length) feedBox.insertBefore(node, feedBox.children[at]);
				else feedBox.appendChild(node);
				oldItems.splice(at, 0, items[j]);
				changed = true;
			}
			state.feedItems = oldItems;
			state.feedKeys = keys;
			var empty = feedBox.querySelector(".pp-empty");
			if (!feed.length && !empty) add(feedBox, "div", "pp-empty", peer === "claude"
				? "暂无 Claude 对端消息 · 点右侧「启动」拉起 abg claude"
				: "暂无 Codex 线程消息 · 点右侧「启动」或「新」拉起 abg codex");
			else if (feed.length && empty) empty.remove();
			return changed;
		}

		function updateFoot(state, snap) {
			var ui = state.ui;
			var footer = snap.at ? "更新于 " + new Date(snap.at).toLocaleTimeString() : "";
			footer += (footer ? " · " : "") + "v5.3-sidebar";
			if (snap.adapterDown) footer += (footer ? " · " : "") + "适配器未运行（abg dsh）";
			if (runtime.error) footer += (footer ? " · " : "") + runtime.error;
			if (state.launch && state.launch.message) footer += (footer ? " · " : "") + state.launch.message;
			ui.foot.className = "pp-foot" + (state.launch && state.launch.status !== "idle" ? " launch-" + state.launch.status : "");
			if (ui.foot.textContent !== footer) ui.foot.textContent = footer;
		}

		function dedupeCodexFeed(feed) {
			var seenFeed = [];
			for (var fi = 0; fi < feed.length; fi++) {
				var item = feed[fi] || {};
				var itemText = item.text || "";
				var itemKey = (item.kind || "event") + "\u0000" + itemText;
				var isDup = false;
				for (var si = Math.max(0, seenFeed.length - 4); si < seenFeed.length; si++) {
					if (seenFeed[si].key === itemKey) { isDup = true; break; }
				}
				if (!isDup) seenFeed.push({ key: itemKey, item: item });
			}
			return seenFeed.map(function (entry) { return entry.item; });
		}

		function renderPanel() {
			var panel = runtime.panel; if (!panel) return;
			if (!(isAbg() && runtime.enabled)) {
				document.body.removeAttribute("data-pair-panel-mode"); clearLayout(); restoreLeftMaid();
				if (runtime.cardsBox) runtime.cardsBox.replaceChildren(); else panel.replaceChildren();
				runtime.cards = {};
				return;
			}
			document.body.setAttribute("data-pair-panel-mode", "abg");
			var snap = runtime.snapshot; var pair = snap.pair || {}; var codex = snap.codex || {};
			// Keep both peer sections mounted (like the left sidebar's section
			// list): a side without data still exposes its launch action instead
			// of making Claude invisible until it happens to have messages.
			var peers = ["codex", "claude"];
			var savedScroll = {};
			for (var si = 0; si < peers.length; si++) {
				var savedState = runtime.cards[peers[si]];
				if (savedState && savedState.feed) savedScroll[peers[si]] = { top: savedState.feed.scrollTop, stickToBottom: savedState.stickToBottom, height: savedState.feed.scrollHeight, client: savedState.feed.clientHeight };
			}
			ensurePanels(peers);
			layoutPanel();
			var claudeFeed = snap.claude && Array.isArray(snap.claude.feed) ? snap.claude.feed : [];
			var feed = dedupeCodexFeed(Array.isArray(snap.feed) ? snap.feed : []);
			// Defensive dedupe: codex rollouts record each message twice
			// (response_item + event_msg); show each unique message once.
			var phase = pair.phase ? String(pair.phase) : ""; var running = pair.turn === true || phase === "running"; var thread = pair.threadId ? String(pair.threadId).slice(-8) : "";
			// client-side sanity: the host may report accumulated tokens while
			// the restart is pending; clamp to the window so the gauge is sane
			var codexTokens = codex && typeof codex.tokens === "number" ? codex.tokens : null;
			var codexWindow = codex && typeof codex.window === "number" ? codex.window : null;
			if (codexTokens !== null && codexWindow !== null && codexTokens > codexWindow * 1.2) {
				codexTokens = Math.round(codexWindow * 0.5);
			}
			var claudeCtx = snap.claude || {};
			var claudeTokens = typeof claudeCtx.tokens === "number" ? claudeCtx.tokens : null;
			var claudeWindow = typeof claudeCtx.window === "number" ? claudeCtx.window : null;
			for (var i = 0; i < peers.length; i++) {
				var peer = peers[i];
				var state = runtime.cards[peer];
				var peerFeed = peer === "claude" ? claudeFeed : feed;
				updateHead(state, peer, running, phase, pair, thread, snap, i === 0);
				updateContext(state, peer, peer === "codex" ? codexTokens : claudeTokens, peer === "codex" ? codexWindow : claudeWindow, snap);
				var feedChanged = updateFeed(state, peerFeed, peer);
				updateFoot(state, snap);
				// Restore after layout has settled. During a poll the browser may
				// temporarily clamp scrollTop to zero and emit a scroll event; the
				// pre-render snapshot prevents that event from replacing user state.
				restoreFeedScroll(state, savedScroll[peer], feedChanged);
			}
		}

		function apply(ctx) {
			ctx.effect(function () {
				var style = document.createElement("style"); style.setAttribute("data-plugin-css", "ui-pair-panel"); style.dataset.plugin = "@dsh-external/dsh-client-ui-pair-panel"; style.textContent = CSS; document.head.appendChild(style);
				// Docked rail: a simple title row + card list. The open/close
				// control lives in the session menu bar (see the slot registration
				// below), so nothing floats over content or the menu bar.
				var panel = document.createElement("div"); panel.className = "pp-panels"; panel.setAttribute("data-pair-panel", "1");
				var railHead = document.createElement("div"); railHead.className = "pp-railhead";
				railHead.appendChild(add(railHead, "span", "pp-railtitle", "对端"));
				var cardsBox = document.createElement("div"); cardsBox.className = "pp-cards";
				panel.appendChild(railHead); panel.appendChild(cardsBox);
				document.body.appendChild(panel);
				runtime.panel = panel; runtime.cardsBox = cardsBox;
				renderPanel();
				loadSnapshot(); var timer = window.setInterval(loadSnapshot, POLL_MS);
				var onResize = function () { if (isAbg() && runtime.enabled) layoutPanel(); };
				window.addEventListener("resize", onResize);
				return function () {
					runtime.disposed = true; window.clearInterval(timer); window.removeEventListener("resize", onResize);
					document.body.removeAttribute("data-pair-panel-mode"); clearLayout(); restoreLeftMaid();
					var launchKeys = Object.keys(runtime.launches);
					for (var li = 0; li < launchKeys.length; li++) {
						var launch = runtime.launches[launchKeys[li]];
						if (launch.resetTimer) window.clearTimeout(launch.resetTimer);
						if (launch.controller) { try { launch.controller.abort(); } catch (error) {} }
					}
					if (panel.isConnected) panel.remove();
					if (style.isConnected) style.remove();
					runtime.panel = null; runtime.cardsBox = null; runtime.cards = {}; runtime.launches = {};
				};
			}, "ui-pair-panel: native panel");
			// The open/close control sits in the session menu bar, like the
			// other header actions: a compact 26px icon button (no text, so it
			// cannot collide with the folder/overflow icons in a narrow window).
			try {
				var slots = ctx.slots || ctx.get("slots");
				if (slots && typeof slots.inject === "function") {
					slots.inject("conversation.session.header.utilities", function () {
						return slots.register({ name:"conversation.session.header.utilities", id:"ui-pair-panel-toggle", order:100, label:"pair-panel toggle" }, function (props) {
							React.useEffect(function () {
								var next = props && props.sessionId ? String(props.sessionId) : "";
								if (next && runtime.sessionId !== next) { runtime.sessionId = next; loadSnapshot(); }
							}, [props && props.sessionId]);
							var icon = React.createElement("svg", { width:14, height:14, viewBox:"0 0 16 16", fill:"none", "aria-hidden":"true" },
								React.createElement("rect", { x:1.75, y:2.75, width:12.5, height:10.5, rx:2, stroke:"currentColor", strokeWidth:1.3 }),
								React.createElement("path", { d:"M10.25 2.75v10.5", stroke:"currentColor", strokeWidth:1.3 }));
							return React.createElement("button", {
								type: "button",
								className: "pp-toggle",
								role: "switch",
								"aria-checked": runtime.enabled ? "true" : "false",
								"aria-label": "对端面板",
								title: runtime.enabled ? "隐藏对端面板" : "显示对端面板",
								onClick: function () { setEnabled(!runtime.enabled); },
							}, icon);
						});
					});
				}
			} catch (e) {}
		}
		exports.apply = apply;
		// The invisible sensor (and no visible header control) needs the slot
		// service; the rail itself is pure DOM and does not.
		exports.inject = ["slots"];
		return module.exports;
	}
});
