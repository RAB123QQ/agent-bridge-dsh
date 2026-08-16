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

		var runtime = { dsh: null, snapshot: null, error: null, panel: null, cards: {}, launches: {}, listeners: [], enabled: true, pairSel: "", disposed: false };
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
.pp-panels { position:fixed; top:76px; right:0; bottom:164px; display:none; gap:8px; z-index:0; pointer-events:none; }
body[data-pair-panel-mode='abg'] .pp-panels { display:flex; }
.pp-card { flex:1 1 0; min-width:0; min-height:0; display:flex; flex-direction:column; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l1); border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,.16), 0 2px 10px rgba(0,0,0,.07); pointer-events:auto; overflow:hidden; font:13px/1.5 ui-sans-serif,system-ui,'PingFang SC','Microsoft YaHei',sans-serif; }
.pp-toggle { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 8px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:12px/1 ui-sans-serif,system-ui,sans-serif; cursor:pointer; }
.pp-toggle:hover { border-color:var(--dsw-alias-border-l3); background:var(--dsw-alias-interactive-bg-hover); }
.pp-toggle-dot { width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-label-tertiary); }
.pp-actions { margin-left:auto; display:flex; align-items:center; gap:6px; flex:none; }
.pp-launch { min-width:66px; height:24px; display:inline-flex; align-items:center; justify-content:center; gap:5px; border:1px solid var(--dsw-alias-border-l2); border-radius:6px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); font:11px/1 ui-sans-serif,system-ui,sans-serif; padding:0 8px; cursor:pointer; flex:none; transition:border-color .15s ease,color .15s ease,background .15s ease; }
.pp-launch:hover:not(:disabled) { border-color:var(--dsw-alias-border-l3); background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.pp-launch:disabled { cursor:default; }
.pp-launch.starting { color:var(--dsw-alias-state-warn-primary); border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent); cursor:progress; }
.pp-launch.success { color:var(--dsw-alias-state-success-primary); border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent); background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.pp-launch.error { color:var(--dsw-alias-state-error-primary); border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.pp-launch-new { color:var(--dsw-alias-label-secondary); border-color:var(--dsw-alias-border-l2); margin-left:4px; min-width:26px; padding:3px 6px; }
.pp-launch-new:disabled { opacity:.5; cursor:default; }
.pp-launch.starting .pp-launch-icon { animation:pp-spin .9s linear infinite; }
@keyframes pp-spin { to { transform:rotate(360deg); } }
.pp-toggle[aria-checked='true'] .pp-toggle-dot { background:var(--dsw-alias-state-success-primary); box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success-primary) 25%, transparent); }
.pp-head { display:flex; align-items:center; gap:8px; padding:9px 12px; flex:none; background:var(--dsw-alias-bg-layer-1); border-bottom:1px solid var(--dsw-alias-border-l1); }
.pp-title { font-weight:600; color:var(--dsw-alias-label-primary); letter-spacing:0; font-size:13px; }
.pp-sub { color:var(--dsw-alias-label-tertiary); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.pp-chip { padding:1px 8px; border-radius:999px; font-size:11px; flex:none; border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-1); }
.pp-chip.running { color:var(--dsw-alias-state-success-primary); border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent); background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); animation:pp-pulse 1.6s ease-in-out infinite; }
@keyframes pp-pulse { 0%,100%{opacity:1} 50%{opacity:.55} }
.pp-ctx { flex:none; padding:9px 12px; border-bottom:1px solid var(--dsw-alias-border-l1); display:flex; flex-direction:column; gap:8px; background:var(--dsw-alias-bg-layer-1); }
.pp-gauge { display:flex; flex-direction:column; gap:3px; }
.pp-gauge-row { display:flex; justify-content:space-between; gap:12px; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.pp-gauge-row b { color:var(--dsw-alias-label-primary); font-weight:600; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; max-width:72%; }
.pp-bar { height:6px; border-radius:3px; background:var(--dsw-alias-border-l2); overflow:hidden; }
.pp-bar>i { display:block; height:100%; border-radius:3px; background:var(--dsw-alias-brand-primary); transition:width .4s ease; }
.pp-bar>i.warn { background:var(--dsw-alias-state-warn-primary); }
.pp-feed { flex:1; min-height:0; overflow-y:auto; padding:9px 10px 12px; display:flex; flex-direction:column; gap:6px; background:var(--dsw-alias-bg-layer-2); scrollbar-width:thin; scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent; }
.pp-feed > * { flex:none; } /* flex column would squash rows instead of overflowing; pin their height so the feed really scrolls */
.pp-msg { border-radius:8px; padding:6px 10px; max-width:92%; white-space:pre-wrap; word-break:break-word; font-size:12px; }
.pp-msg.user { align-self:flex-end; background:var(--dsw-alias-interactive-bg-hover-accent); border:1px solid var(--dsw-alias-border-l2); }
.pp-msg.assistant { align-self:flex-start; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1); }
.pp-tool { align-self:flex-start; font:11px/1.5 ui-monospace,monospace; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-markdown-code-block); border:1px dashed var(--dsw-alias-border-l2); border-radius:6px; padding:3px 8px; max-width:100%; word-break:break-all; }
.pp-task { align-self:center; color:var(--dsw-alias-label-tertiary); font-size:11px; }
.pp-time { color:var(--dsw-alias-label-tertiary); font-size:10px; margin-left:6px; }
.pp-empty { color:var(--dsw-alias-label-tertiary); font-size:12px; text-align:center; padding:20px 0; }
.pp-foot { flex:none; padding:6px 12px; font-size:10px; color:var(--dsw-alias-label-tertiary); border-top:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); }
.pp-foot.launch-starting { color:var(--dsw-alias-state-warn-primary); }
.pp-foot.launch-success { color:var(--dsw-alias-state-success-primary); }
.pp-foot.launch-error { color:var(--dsw-alias-state-error-primary); }
`;

		function notify() { for (var i = 0; i < runtime.listeners.length; i++) { try { runtime.listeners[i](); } catch (error) {} } }
		function subscribe(listener) { runtime.listeners.push(listener); return function () { runtime.listeners = runtime.listeners.filter(function (item) { return item !== listener; }); }; }
		function isAbg() { return !!(runtime.snapshot && runtime.snapshot.ok && (runtime.snapshot.mode === "abg" || runtime.snapshot.mode === "plain")); }
		function loadSnapshot() {
			if (runtime.disposed) return;
			fetch("/pair-panel/snapshot?pair=" + encodeURIComponent(runtime.pairSel || ""), { cache:"no-store" })
				.then(function (response) { if (!response.ok) throw new Error("snapshot HTTP " + response.status); return response.json(); })
				.then(function (data) { if (runtime.disposed) return; runtime.snapshot = data; runtime.error = null; renderPanel(); notify(); })
				.catch(function (error) { if (runtime.disposed) return; runtime.snapshot = null; runtime.error = String((error && error.message) || error); renderPanel(); notify(); });
		}

		// The right maid stays at the viewport edge untouched. The panel is
		// positioned to her left, flush against the conversation column, so the
		// two never overlap. All values are measured at runtime; if the maid is
		// not ready yet we do NOT shift anything (avoids pushing the column
		// left with a wrong estimate).
		var LAYOUT_GAP = 12;
		var PANELS_GAP = 8;
		var WHALE_GAP = 16;
		var PANEL_SHIFT = 110; // extra leftward offset for panel + conversation
		var layoutApplied = false;
		var leftMaidTouched = false;

		// The left maid keeps her skin position (standing right of the
		// sidebar) but is shrunk so conversation bubbles never cover her.
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
			var viewport = document.documentElement.clientWidth || window.innerWidth;
			var whale = document.querySelector("[data-maid-character='right']");
			if (whale && whale.tagName === "IMG" && !whale.complete && !runtime.whaleLoadPending) {
				runtime.whaleLoadPending = true;
				whale.addEventListener("load", function () { runtime.whaleLoadPending = false; if (isAbg() && runtime.enabled) layoutPanel(); }, { once: true });
			}
			// Without the maid-atelier skin there is no whale to anchor to;
			// fall back to a fixed right-side reserve so the panel still sits
			// beside the conversation. With the skin, anchor to the real maid.
			var whaleLeft = whale ? whale.getBoundingClientRect().left : 0;
			if (!whale) {
				whaleLeft = viewport + WHALE_GAP; // no skin: panel flush to the viewport right edge
			} else if (!isFinite(whaleLeft) || whaleLeft <= 0 || whaleLeft > viewport * 0.98) {
				// maid not laid out yet: keep the original layout untouched
				return;
			}
			// The DSH conversation content is centered inside its column with
			// side padding, so the column edge is NOT where the chat ends. The
			// panel is anchored to the right maid; the column margin is solved
			// so the input's right edge lands exactly LAYOUT_GAP left of the
			// panel. No iteration on the current content position, so no
			// fixed-point trap.
			var input = document.querySelector('textarea, [contenteditable="true"]');
			var inputWidth = 0;
			if (input) {
				var ir = input.getBoundingClientRect();
				if (isFinite(ir.width) && ir.width > 0) inputWidth = ir.width;
			}
			// Panel bottom is a fixed offset from the viewport (see .pp-card
			// CSS) and does NOT track the DSH composer, so it never jumps when
			// the input box grows or shrinks.
			var convEl = document.querySelector("[class*='centerCol']");
			var convLeft = convEl ? convEl.getBoundingClientRect().left : 0;
			if (!isFinite(convLeft) || convLeft <= 0) convLeft = 280;
			// The wrapper owns positioning. A dual peer reserves two card widths
			// plus the inter-card gap; a single peer keeps the original 448px aim.
			var dual = !!(runtime.snapshot && runtime.snapshot.peer === "both");
			var cardCount = dual ? 2 : 1;
			var panelsGap = dual ? PANELS_GAP : 0;
			var desiredWidth = (dual ? 380 : 448) * cardCount + panelsGap;
			var minWidth = (dual ? 260 : 240) * cardCount + panelsGap;
			var availableWidth = whaleLeft - WHALE_GAP - convLeft - inputWidth - LAYOUT_GAP;
			var panelWidth = Math.min(desiredWidth, Math.max(minWidth, availableWidth));
			// wrapper left is anchored to the right maid, with a small extra
			// leftward shift for the panel + conversation pair
			var panelLeft = Math.max(0, whaleLeft - WHALE_GAP - panelWidth - (whale ? PANEL_SHIFT : 0));
			// solve the column margin so the centered input lands flush:
			// inputRight = convLeft + (colWidth + inputWidth)/2 = panelLeft - LAYOUT_GAP
			// with colWidth = viewport - convLeft - margin
			var convMargin = viewport - panelLeft;
			if (!whale) {
				// no skin: keep the conversation column clear of the panel so
				// the composer / floating buttons never sit under it
				convMargin = panelWidth + WHALE_GAP + LAYOUT_GAP;
			} else if (inputWidth > 0) {
				convMargin = viewport + convLeft + inputWidth - 2 * panelLeft + 2 * LAYOUT_GAP;
				convMargin = Math.max(0, convMargin);
			}
			var right = Math.max(0, viewport - panelLeft - panelWidth);
			var panel = runtime.panel;
			if (panel && panel.style.right !== right + "px") panel.style.right = right + "px";
			if (panel && panel.style.width !== panelWidth + "px") panel.style.width = panelWidth + "px";
			var conv = document.querySelector("[class*='centerCol']");
			if (conv && conv.style.marginRight !== convMargin + "px") conv.style.marginRight = convMargin + "px";
			adjustLeftMaid();
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
		function updateItemText(row, item) {
			var span = row.querySelector ? row.querySelector(".pp-text") : null;
			var text = rowText(item);
			if (span) { if (span.textContent !== text) span.textContent = text; }
			else if (row.textContent !== text) row.textContent = text;
		}

		function buildFeedItem(item) {
			var row = document.createElement("div");
			if (item.kind === "message") row.className = "pp-msg " + (item.role === "user" ? "user" : "assistant");
			else if (item.kind === "tool" || item.kind === "tool-out") row.className = "pp-tool";
			else row.className = "pp-task";
			var span = document.createElement("span"); span.className = "pp-text"; span.textContent = rowText(item);
			row.appendChild(span);
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
			var pairName = state.peer === "claude" ? "cf" : "main";
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
			runtime.panel.appendChild(panel);
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
				var current = runtime.panel.children[k] || null;
				// Keep the requested order without detaching cards that are already
				// in place; reparenting a scroll container resets its scrollTop.
				if (current !== state.panel) runtime.panel.insertBefore(state.panel, current);
			}
			runtime.panel.className = "pp-panels " + (peers.length === 2 ? "both" : "single");
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
			var stickToBottom = saved ? saved.stickToBottom : state.stickToBottom;
			var targetTop = saved ? saved.top : state.userScrollTop;
			var token = ++state.scrollRestoreToken;
			state.restoringScroll = true;
			window.requestAnimationFrame(function () {
				if (token !== state.scrollRestoreToken || !feed.isConnected) return;
				if (feedChanged && stickToBottom) feed.scrollTop = feed.scrollHeight;
				else feed.scrollTop = Math.min(targetTop || 0, Math.max(0, feed.scrollHeight - feed.clientHeight));
				state.userScrollTop = feed.scrollTop;
				state.stickToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48;
				window.requestAnimationFrame(function () {
					if (token === state.scrollRestoreToken) state.restoringScroll = false;
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
			if (!feed.length && !empty) add(feedBox, "div", "pp-empty", peer === "claude" ? "暂无对端消息（等待 Claude 发送消息）" : "暂无对端消息（等待 Codex 线程写入 rollout）");
			else if (feed.length && empty) empty.remove();
			return changed;
		}

		function updateFoot(state, snap) {
			var ui = state.ui;
			var footer = snap.at ? "更新于 " + new Date(snap.at).toLocaleTimeString() : "";
			footer += (footer ? " · " : "") + "v5.3-scrollguard";
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
				panel.replaceChildren(); runtime.cards = {};
				return;
			}
			document.body.setAttribute("data-pair-panel-mode", "abg");
			var snap = runtime.snapshot; var pair = snap.pair || {}; var codex = snap.codex || {};
			var peers = snap.peer === "both" ? ["codex", "claude"] : [snap.peer === "claude" ? "claude" : "codex"];
			var savedScroll = {};
			for (var si = 0; si < peers.length; si++) {
				var savedState = runtime.cards[peers[si]];
				if (savedState && savedState.feed) savedScroll[peers[si]] = { top: savedState.feed.scrollTop, stickToBottom: savedState.stickToBottom };
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

		function Sensor(props) {
			var rerender = React.useState(0)[1]; React.useEffect(function () { return subscribe(function () { rerender(function (value) { return value + 1; }); }); }, []);
			var pressure = null; try { if (typeof props.useProjection === "function") pressure = props.useProjection("contextPressure"); } catch (error) {}
			var used = pressure && typeof pressure.projectedTokens === "number" ? pressure.projectedTokens : (pressure && typeof pressure.pressureTokens === "number" ? pressure.pressureTokens : null);
			var windowSize = pressure && typeof pressure.contextWindow === "number" ? pressure.contextWindow : null;
			React.useEffect(function () { if (!runtime.dsh || runtime.dsh.used !== used || runtime.dsh.window !== windowSize) { runtime.dsh = { used: used, window: windowSize }; renderPanel(); } }, [used, windowSize]);
			if (!isAbg()) return null;
			return React.createElement("button", { type:"button", className:"pp-toggle", role:"switch", "aria-checked":runtime.enabled ? "true" : "false", title:runtime.enabled ? "关闭 Codex 对端面板" : "打开 Codex 对端面板", onClick:function () { setEnabled(!runtime.enabled); } }, React.createElement("span", { className:"pp-toggle-dot", "aria-hidden":"true" }), "Codex 面板");
		}

		function apply(ctx) {
			ctx.effect(function () {
				var style = document.createElement("style"); style.setAttribute("data-plugin-css", "ui-pair-panel"); style.textContent = CSS; document.head.appendChild(style);
				var panel = document.createElement("div"); panel.className = "pp-panels single"; panel.setAttribute("data-pair-panel", "1"); document.body.appendChild(panel); runtime.panel = panel;
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
					runtime.panel = null; runtime.cards = {}; runtime.launches = {};
				};
			}, "ui-pair-panel: native panel");
			var slots = ctx.get("slots"); if (!slots) return;
			slots.inject("conversation.session.header.actions", function () { return slots.register({ name:"conversation.session.header.actions", id:"ui-pair-panel-sensor", order:100, label:"pair-panel sensor" }, function (props) { return React.createElement(Sensor, props); }); });
		}
		exports.apply = apply;
		return module.exports;
	}
});
