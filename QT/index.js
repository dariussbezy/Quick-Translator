(() => {
  "use strict";
  const { metro, patcher, plugin, ui } = vendetta;
  const vstorage = vendetta.storage;
  const { findByProps, findByStoreName } = metro;
  const { FluxDispatcher, React, ReactNative: RN } = metro.common;

  const BUILD = "v1.0.0";
  const FLAG_TOGGLE = 0x04000000;
  const ACCENT = "#8EA1FF";
  const MAX_TRANSLATIONS = 300;
  const MAX_CACHE = 200;
  const MAX_FAVS = 6;
  const TIMEOUT = 12000;
  const PROTECT = /```[\s\S]*?```|`[^`\n]+`|<a?:\w+:\d+>|<[@#][!&]?\d+>|<t:-?\d+(?::[A-Za-z])?>|https?:\/\/[^\s<>]+/g;
  const INLINE = new Set(["text", "strong", "em", "u", "s", "inlineCode"]);

  const LANGS = [
    ["en", "English"], ["ro", "Romanian"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["it", "Italian"],
    ["pt", "Portuguese"], ["ru", "Russian"], ["uk", "Ukrainian"], ["pl", "Polish"], ["nl", "Dutch"], ["tr", "Turkish"],
    ["ar", "Arabic"], ["he", "Hebrew"], ["hi", "Hindi"], ["ja", "Japanese"], ["ko", "Korean"],
    ["zh-CN", "Chinese (Simplified)"], ["zh-TW", "Chinese (Traditional)"], ["id", "Indonesian"], ["th", "Thai"],
    ["vi", "Vietnamese"], ["sv", "Swedish"], ["da", "Danish"], ["no", "Norwegian"], ["fi", "Finnish"], ["cs", "Czech"],
    ["sk", "Slovak"], ["hu", "Hungarian"], ["el", "Greek"], ["bg", "Bulgarian"], ["sr", "Serbian"], ["hr", "Croatian"],
    ["sl", "Slovenian"], ["lt", "Lithuanian"], ["lv", "Latvian"], ["et", "Estonian"], ["fa", "Persian"], ["bn", "Bengali"],
    ["ur", "Urdu"], ["ms", "Malay"], ["ta", "Tamil"], ["te", "Telugu"], ["sw", "Swahili"], ["af", "Afrikaans"],
    ["ca", "Catalan"], ["tl", "Filipino"], ["is", "Icelandic"], ["ga", "Irish"], ["cy", "Welsh"], ["sq", "Albanian"],
    ["mk", "Macedonian"], ["ka", "Georgian"], ["hy", "Armenian"], ["az", "Azerbaijani"], ["kk", "Kazakh"],
    ["uz", "Uzbek"], ["mn", "Mongolian"], ["ne", "Nepali"], ["si", "Sinhala"], ["my", "Myanmar"], ["km", "Khmer"],
    ["lo", "Lao"], ["la", "Latin"], ["eo", "Esperanto"],
  ];
  const LANG_NAME = new Map(LANGS);

  const translations = new Map();
  const cache = new Map();
  const unpatches = [];
  const bridge = { text: "", change: null, inst: null, seen: 0 };
  const refWrappers = new WeakMap();
  let armed = null;
  let lastOriginal = null;
  let renderUnpatch = null;
  let renderErrors = 0;
  let MessageStore;
  let UserStore;
  let ChannelStore;
  let SelectedChannelStore;
  let ThemeStore;
  let ActionSheet;
  let MessageActions;

  const cfg = () => plugin.storage;
  const toast = (t) => { try { ui.toasts.showToast(t); } catch (_) {} };
  const trimMap = (m, max) => { while (m.size > max) m.delete(m.keys().next().value); };
  const langName = (code) => (code === "auto" ? "Auto-detect" : LANG_NAME.get(code) || code);
  const safe = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };

  function nameOf(u) {
    if (!u) return "Unknown";
    return u.globalName || u.global_name || u.username || "Unknown";
  }

  function loadStores() {
    MessageStore = MessageStore || findByStoreName("MessageStore");
    UserStore = UserStore || findByStoreName("UserStore");
    ChannelStore = ChannelStore || findByStoreName("ChannelStore");
    return !!(MessageStore && UserStore && FluxDispatcher);
  }

  const getMessage = (c, id) => safe(() => MessageStore.getMessage(c, id) || null, null);
  const getChannel = (id) => safe(() => (id ? ChannelStore.getChannel(id) : null), null);
  const isDM = (ch) => !!ch && (ch.type === 1 || ch.type === 3);

  function currentChannelId() {
    return safe(() => {
      SelectedChannelStore = SelectedChannelStore || findByStoreName("SelectedChannelStore");
      return SelectedChannelStore.getChannelId();
    }, null);
  }

  function palette() {
    const light = safe(() => {
      ThemeStore = ThemeStore || findByStoreName("ThemeStore");
      return !!ThemeStore && ThemeStore.theme === "light";
    }, false);
    return light
      ? { text: "#060607", sub: "#5C5E66", bg: "#FFFFFF", card: "#F2F3F5", line: "#D4D7DC" }
      : { text: "#FFFFFF", sub: "#B5BAC1", bg: "#1E1F22", card: "#2B2D31", line: "#3F4147" };
  }

  const HEX = /^#[0-9A-Fa-f]{6}$/;
  const translationColor = () => (HEX.test(String(cfg().translationColor || "")) ? String(cfg().translationColor).toUpperCase() : ACCENT);

  function closeAlert() {
    try {
      const alerts = findByProps("openLazy", "close");
      if (alerts && typeof alerts.close === "function") alerts.close();
    } catch (_) {}
  }

  function ColorModal(props) {
    const h = React.createElement;
    const [value, setValue] = React.useState(String(props.initialValue || ACCENT));
    const [error, setError] = React.useState("");
    const C = palette();
    const presets = [
      ["Default", ACCENT], ["Red", "#ED4245"], ["Orange", "#F07B3E"], ["Gold", "#F1C40F"], ["Green", "#43B581"],
      ["Teal", "#1ABC9C"], ["Blue", "#3498DB"], ["Indigo", "#5865F2"], ["Purple", "#9B59B6"], ["Pink", "#EB459E"], ["Gray", "#80848E"],
    ];
    const action = (label, onPress, primary) =>
      h(RN.Pressable, {
        key: label, onPress,
        style: { minHeight: 44, paddingHorizontal: 16, borderRadius: 8, marginLeft: primary ? 10 : 0, alignItems: "center", justifyContent: "center", backgroundColor: primary ? "#5865F2" : "rgba(128,128,128,0.22)" },
      }, h(RN.Text, { style: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" } }, label));
    const finish = (hex) => { closeAlert(); props.onSave(hex); };
    const save = () => {
      const hex = String(value).trim().toUpperCase();
      if (!HEX.test(hex)) { setError("Enter a HEX color such as #3366FF."); return; }
      finish(hex);
    };
    return h(RN.ScrollView, { style: { width: "100%", maxWidth: 440, maxHeight: "90%", alignSelf: "center", padding: 20, borderRadius: 14, backgroundColor: C.bg } },
      h(RN.Text, { style: { color: C.text, fontSize: 20, fontWeight: "700", marginBottom: 8 } }, "Translation color"),
      h(RN.Text, { style: { color: C.sub, fontSize: 14, marginBottom: 12 } }, "Choose a preset or enter a HEX color."),
      h(RN.View, { style: { flexDirection: "row", flexWrap: "wrap", marginBottom: 12 } }, presets.map(([label, hex]) =>
        h(RN.Pressable, { key: hex, onPress: () => { setValue(hex); setError(""); }, style: { width: 62, alignItems: "center", marginRight: 6, marginBottom: 8 } },
          h(RN.View, { style: { width: 34, height: 34, borderRadius: 17, backgroundColor: hex, borderWidth: value.toUpperCase() === hex ? 3 : 1, borderColor: C.text } }),
          h(RN.Text, { style: { color: C.text, fontSize: 11, marginTop: 3 } }, label)))),
      h(RN.View, { style: { width: 44, height: 24, marginBottom: 12, borderRadius: 6, backgroundColor: HEX.test(value) ? value : "transparent", borderWidth: 1, borderColor: C.sub } }),
      h(RN.TextInput, {
        value, onChangeText: (t) => { setValue(t); setError(""); }, autoCapitalize: "characters", autoCorrect: false, placeholder: "#3366FF", placeholderTextColor: C.sub,
        style: { minHeight: 48, paddingHorizontal: 12, borderRadius: 8, color: C.text, fontSize: 17, backgroundColor: "rgba(128,128,128,0.16)" },
      }),
      error ? h(RN.Text, { style: { color: "#ED4245", fontSize: 13, marginTop: 8 } }, error) : null,
      h(RN.View, { style: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", marginTop: 18 } },
        action("Default", () => finish(ACCENT), false), action("Cancel", closeAlert, false), action("Save", save, true)));
  }

  function ask(title, message, buttons) {
    const ios = RN.Platform && RN.Platform.OS === "ios";
    const list = buttons.slice(0, ios ? 6 : 3);
    if (ios) list.push({ text: "Cancel", style: "cancel" });
    try { RN.Alert.alert(title, message, list, { cancelable: true }); } catch (_) {}
  }

  function copyText(text) {
    try {
      const clip = findByProps("setString");
      if (clip && clip.setString) { clip.setString(text); toast("Copied"); return; }
    } catch (_) {}
    try { RN.Clipboard.setString(text); toast("Copied"); } catch (_) {}
  }

  // ---------- translation ----------
  function fetchT(url, opts) {
    return Promise.race([
      fetch(url, opts),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out")), TIMEOUT)),
    ]);
  }

  function callApi(text, tl, sl) {
    const params = "client=gtx&dt=t&sl=" + encodeURIComponent(sl || "auto") + "&tl=" + encodeURIComponent(tl);
    const base = "https://translate.googleapis.com/translate_a/single?" + params;
    const req = text.length < 1200
      ? fetchT(base + "&q=" + encodeURIComponent(text))
      : fetchT(base, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: "q=" + encodeURIComponent(text),
        });
    return req.then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then((json) => {
      const segments = Array.isArray(json) && Array.isArray(json[0]) ? json[0] : [];
      const out = segments.map((s) => (s && s[0]) || "").join("");
      if (!out && text.trim()) throw new Error("Empty response");
      return { text: out, src: (Array.isArray(json) && typeof json[2] === "string" && json[2]) || sl };
    });
  }

  function prettyToken(t) {
    let m;
    if ((m = /^<a?:(\w+):\d+>$/.exec(t))) return ":" + m[1] + ":";
    if ((m = /^<@!?(\d+)>$/.exec(t))) return "@" + nameOf(safe(() => UserStore.getUser(m[1]), null));
    if ((m = /^<#(\d+)>$/.exec(t))) return "#" + ((getChannel(m[1]) || {}).name || "channel");
    if (/^<@&\d+>$/.test(t)) return "@role";
    if (/^<t:/.test(t)) return "";
    return t;
  }

  function protect(text) {
    const tokens = [];
    const out = text.replace(PROTECT, (m) => { tokens.push(m); return "§" + (tokens.length - 1) + "§"; });
    return { out, tokens };
  }

  function restore(text, tokens, pretty) {
    const used = new Set();
    let out = text.replace(/§\s*(\d+)\s*§/g, (m, i) => {
      const t = tokens[Number(i)];
      if (t === undefined) return m;
      used.add(Number(i));
      return pretty ? prettyToken(t) : t;
    });
    if (!pretty) {
      const missing = tokens.filter((_, i) => !used.has(i));
      if (missing.length) out += " " + missing.join(" ");
    }
    return out;
  }

  function translate(text, tl, sl, pretty) {
    const source = sl || "auto";
    const cacheKey = (pretty ? "p|" : "r|") + source + "|" + tl + "|" + text;
    if (cache.has(cacheKey)) return Promise.resolve(cache.get(cacheKey));
    const { out, tokens } = protect(text);
    if (!out.replace(/§\d+§/g, "").trim()) return Promise.resolve({ same: true, text, src: source });
    return callApi(out, tl, source).then((res) => {
      const base = String(tl).toLowerCase().split("-")[0];
      const detected = String(res.src || "").toLowerCase().split("-")[0];
      const result = detected && detected === base && source === "auto"
        ? { same: true, text, src: res.src }
        : { same: false, text: restore(res.text, tokens, pretty), src: res.src };
      cache.set(cacheKey, result);
      trimMap(cache, MAX_CACHE);
      return result;
    });
  }

  // ---------- chat input bridge ----------
  function isChatInput(props) {
    const ph = props.placeholder;
    if (typeof ph !== "string") return false;
    if (/^(message|mesaj|mensaje|nachricht|messag|написать|сообщение)/i.test(ph)) return true;
    const ch = getChannel(currentChannelId());
    if (!ch) return false;
    let name = ch.name;
    if (isDM(ch) && !name) {
      const rid = ch.recipients && ch.recipients[0];
      name = rid ? nameOf(safe(() => UserStore.getUser(rid), null)) : null;
    }
    return !!name && name !== "Unknown" && ph.indexOf(name) !== -1;
  }

  function installInputCapture() {
    const TI = RN.TextInput;
    if (!TI || typeof TI.render !== "function") return;
    unpatches.push(patcher.before("render", TI, (args) => {
      try {
        const props = args[0];
        if (!props || !isChatInput(props)) return;
        bridge.seen = Date.now();
        const original = props.onChangeText;
        bridge.change = typeof original === "function" ? original : null;
        if (typeof props.value === "string") bridge.text = props.value;
        args[0] = Object.assign({}, props, {
          onChangeText: (t) => { bridge.text = t; if (original) original(t); },
        });
        const ref = args[1];
        let wrapped = ref && typeof ref === "object" ? refWrappers.get(ref) : null;
        if (!wrapped) {
          wrapped = (inst) => {
            bridge.inst = inst;
            if (typeof ref === "function") ref(inst);
            else if (ref && typeof ref === "object") ref.current = inst;
          };
          if (ref && typeof ref === "object") refWrappers.set(ref, wrapped);
        }
        args[1] = wrapped;
      } catch (_) {}
    }));
  }

  function readInput() {
    return Date.now() - bridge.seen < 600000 ? bridge.text : "";
  }

  function writeInput(text) {
    let ok = false;
    if (bridge.change) { try { bridge.change(text); ok = true; } catch (_) {} }
    if (bridge.inst && typeof bridge.inst.setNativeProps === "function") {
      try { bridge.inst.setNativeProps({ text }); ok = true; } catch (_) {}
    }
    if (ok) bridge.text = text;
    return ok;
  }

  function translateInput(opts) {
    const tl = opts.tl;
    const sl = opts.sl || "auto";
    const canWrite = !!(bridge.change || bridge.inst) && Date.now() - bridge.seen < 600000;
    if (!canWrite) {
      armed = { tl, sl };
      notifyButton();
      toast("Your next message will be translated to " + langName(tl) + " when you send it");
      return Promise.resolve();
    }
    const text = readInput();
    if (!text || !text.trim()) { toast("Type a message first"); return Promise.resolve(); }
    return translate(text, tl, sl, false).then((r) => {
      if (r.same) { toast("Already in " + langName(tl)); return; }
      lastOriginal = text;
      if (!writeInput(r.text)) {
        ask("Translation (" + langName(tl) + ")", r.text, [{ text: "Copy", onPress: () => copyText(r.text) }]);
      }
    }).catch((e) => {
      toast("Translation failed: " + (e && e.message ? e.message : e));
    });
  }

  function restoreOriginal() {
    if (lastOriginal == null) { toast("Nothing to restore"); return; }
    if (writeInput(lastOriginal)) lastOriginal = null;
    else toast("Could not write to the chat box");
  }

  function installSendHook() {
    try {
      MessageActions = findByProps("sendMessage", "receiveMessage");
      if (!MessageActions) return;
      unpatches.push(patcher.instead("sendMessage", MessageActions, (args, orig) => {
        let pending = null;
        try {
          const msg = args[1];
          const job = armed;
          if ((job || cfg().translateOnSend) && msg && typeof msg.content === "string" && msg.content.trim()) {
            armed = null;
            notifyButton();
            pending = translate(msg.content, job ? job.tl : cfg().targetOut, job ? job.sl : cfg().sourceOut, false).then((r) => {
              if (!r.same) args[1] = Object.assign({}, msg, { content: r.text });
            });
          }
        } catch (_) { toast("Translation failed, sent the original message"); }
        if (!pending) return orig(...args);
        return pending.catch(() => { toast("Translation failed, sent the original message"); }).then(() => orig(...args));
      }));
    } catch (_) {}
  }

  // ---------- messages ----------
  function refreshRow(channelId, id) {
    const msg = getMessage(channelId, id);
    if (!msg) return;
    const guildId = safe(() => getChannel(channelId).guild_id, null);
    setTimeout(() => {
      try {
        FluxDispatcher.dispatch({
          type: "MESSAGE_UPDATE",
          guildId,
          message: { id, channel_id: channelId, guild_id: guildId, flags: (msg.flags | 0) ^ FLAG_TOGGLE },
        });
      } catch (_) {}
    }, 0);
  }

  function translateMessage(message, tl) {
    const text = message && message.content;
    if (typeof text !== "string" || !text.trim()) { toast("This message has no text"); return Promise.resolve(); }
    const channelId = message.channel_id || message.channelId || currentChannelId();
    toast("Translating...");
    return translate(text, tl, "auto", true).then((r) => {
      if (r.same) { toast("Already in " + langName(tl)); return; }
      translations.set(message.id, { text: r.text, src: r.src, tl, at: Date.now(), ch: channelId });
      trimMap(translations, MAX_TRANSLATIONS);
      refreshRow(channelId, message.id);
    }).catch((e) => {
      toast("Translation failed: " + (e && e.message ? e.message : e));
    });
  }

  function refreshTranslated() {
    translations.forEach((t, id) => { if (t.ch) refreshRow(t.ch, id); });
  }

  function showOriginal(message) {
    const channelId = message.channel_id || message.channelId || currentChannelId();
    translations.delete(message.id);
    refreshRow(channelId, message.id);
  }

  function paint(nodes, color) {
    if (!color) return nodes;
    return [{
      type: "link",
      target: "usernameOnClick",
      context: { username: "", usernameOnClick: { action: "0", userId: "0", linkColor: color, messageChannelId: "0" } },
      content: nodes.filter((n) => n && INLINE.has(n.type)),
    }];
  }

  function stripOurs(nodes) {
    const out = [];
    for (const n of nodes) {
      if (n && n.__tr) continue;
      if (n && Array.isArray(n.content)) {
        const inner = stripOurs(n.content);
        if (!inner.length && n.content.length) continue;
        out.push(inner.length === n.content.length ? n : Object.assign({}, n, { content: inner }));
      } else out.push(n);
    }
    return out;
  }

  function decorate(row, input) {
    const m = row && row.message;
    if (!m) return;
    const rowType = input && input.rowType !== undefined ? input.rowType : row.rowType;
    if (rowType !== 1) return;
    const tr = translations.get(m.id);
    const ours = m.__trOut && m.content === m.__trOut;
    if (!tr) {
      if (ours) m.content = m.__trBase;
      else if (Array.isArray(m.content)) {
        const clean = stripOurs(m.content);
        if (clean.length !== m.content.length) m.content = clean;
      }
      return;
    }
    const base = ours ? m.__trBase : Array.isArray(m.content) ? stripOurs(m.content) : null;
    if (!Array.isArray(base)) return;
    const pc = RN && RN.processColor;
    const color = pc ? pc(translationColor()) : null;
    const text = { type: "text", content: tr.text, __tr: true };
    let out;
    if (cfg().immersive) out = base.concat([{ type: "text", content: "\n", __tr: true }], paint([text], color));
    else out = paint([text], color);
    if (!out.length) return;
    m.__trBase = base;
    m.__trOut = out;
    m.content = out;
  }

  function onRenderError() {
    renderErrors++;
    if (renderErrors >= 3 && renderUnpatch) {
      try { renderUnpatch(); } catch (_) {}
      renderUnpatch = null;
      toast("Quick Translate: message styling disabled after repeated errors");
    }
  }

  function patchRender() {
    const finder = metro.findByName;
    let RM = safe(() => finder("RowManager"), null);
    if (!RM || !RM.prototype) RM = safe(() => finder("RowManager", false).default, null);
    if (!RM || !RM.prototype || typeof RM.prototype.generate !== "function") {
      toast("Quick Translate: could not find the message renderer");
      return null;
    }
    return patcher.after("generate", RM.prototype, (args, ret) => {
      try { decorate(ret, args[0]); } catch (_) { onRenderError(); }
    });
  }

  let iconCache;
  let capturedIcon = null;
  const buttonListeners = new Set();
  function notifyButton() { buttonListeners.forEach((f) => { try { f(); } catch (_) {} }); }
  function translateAssetId() {
    if (iconCache === undefined) {
      iconCache = safe(() => {
        const names = Object.keys(ui.assets.all || {});
        const hit = names.find((n) => /translate/i.test(n)) || names.find((n) => /locale/i.test(n)) || names.find((n) => /language|globe/i.test(n));
        return hit ? ui.assets.getAssetIDByName(hit) : null;
      }, null);
    }
    return iconCache;
  }

  // ---------- message long-press menu ----------
  function findGroups(node, seen, depth, out) {
    if (!node || typeof node !== "object" || depth > 40 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const rows = node.filter((e) => e && e.props && typeof e.props.onPress === "function" &&
        (typeof e.props.message === "string" || typeof e.props.label === "string"));
      if (rows.length) { out.push({ list: node, rows }); return; }
      for (const c of node) findGroups(c, seen, depth + 1, out);
      return;
    }
    if (node.props) findGroups(node.props.children, seen, depth + 1, out);
  }

  const rowLabel = (e) => (typeof e.props.message === "string" ? e.props.message : e.props.label);

  function addButtons(tree, plan) {
    const groups = [];
    findGroups(tree, new Set(), 0, groups);
    if (!groups.length) return;
    if (groups.some((g) => g.list.some((e) => e && typeof e.key === "string" && e.key.startsWith("qt-")))) return;
    const last = groups[groups.length - 1];
    const neutral = groups.length > 1 ? groups[groups.length - 2] : last;
    const tpl = neutral.rows[0];
    let nativeIcon;
    for (const g of groups) {
      const hit = g.rows.find((r) => /translate/i.test(rowLabel(r) || ""));
      if (hit) { nativeIcon = hit.props.icon; break; }
    }
    if (nativeIcon !== undefined && nativeIcon !== null) {
      capturedIcon = nativeIcon;
      const src = safe(() => nativeIcon.props.source, null);
      if (typeof src === "number") { try { cfg().iconSource = src; } catch (_) {} }
    }
    const elements = plan.map((item) => {
      const props = {
        key: item.key,
        onPress: () => {
          try { ActionSheet && ActionSheet.hideActionSheet && ActionSheet.hideActionSheet(); } catch (_) {}
          item.press();
        },
      };
      if (typeof tpl.props.message === "string") props.message = item.label;
      if (typeof tpl.props.label === "string") props.label = item.label;
      if (tpl.props.icon !== undefined) {
        if (nativeIcon !== undefined) props.icon = nativeIcon;
        else {
          const el = iconAsComponent();
          if (el) props.icon = el;
          else {
            const id = translateAssetId();
            props.icon = id && React.isValidElement(tpl.props.icon) ? React.cloneElement(tpl.props.icon, { source: id }) : undefined;
          }
        }
      }
      return React.cloneElement(tpl, props);
    });
    last.list.splice(0, 0, ...elements);
  }

  function messagePlan(message) {
    if (!message || !message.id || typeof message.content !== "string" || !message.content.trim()) return null;
    const plan = [];
    if (translations.has(message.id)) {
      plan.push({ key: "qt-original", label: "Show original message", press: () => showOriginal(message) });
    } else {
      plan.push({ key: "qt-translate", label: "Translate to " + langName(cfg().targetIn), press: () => translateMessage(message, cfg().targetIn) });
    }
    plan.push({
      key: "qt-translate-to",
      label: "Translate to...",
      press: () => {
        const favs = (cfg().favLangs || []).filter((c) => LANG_NAME.has(c));
        ask("Translate to", "Choose a language for this message only.",
          favs.map((c) => ({ text: langName(c), onPress: () => translateMessage(message, c) })));
      },
    });
    return plan;
  }

  function hookSheet(args) {
    try {
      const [component, key, ctx] = args;
      if (key !== "MessageLongPressActionSheet" || !component || typeof component.then !== "function") return;
      const plan = messagePlan(ctx && ctx.message);
      if (!plan) return;
      component.then((instance) => {
        const un = patcher.after("default", instance, (_, tree) => {
          React.useEffect(() => () => { un(); }, []);
          try { addButtons(tree, plan); } catch (_) {}
        });
      });
    } catch (_) {}
  }

  // ---------- chat bar button ----------
  function nameOfComponent(c) {
    if (!c) return null;
    if (typeof c === "function") return c.displayName || c.name || null;
    if (typeof c === "object") {
      return c.displayName || nameOfComponent(c.type) || nameOfComponent(c.render) || null;
    }
    return null;
  }

  function findComponentModule(name) {
    return safe(() => metro.find((m) => {
      try {
        if (!m) return false;
        if (nameOfComponent(m) === name) return true;
        return !!m.default && nameOfComponent(m.default) === name;
      } catch (_) { return false; }
    }), null);
  }

  function patchTarget(comp) {
    let cur = comp;
    for (let i = 0; i < 4 && cur; i++) {
      if (typeof cur === "function") return null;
      if (typeof cur.type === "function") return [cur, "type"];
      if (typeof cur.render === "function") return [cur, "render"];
      cur = cur.type;
    }
    return null;
  }

  function iconAsComponent() {
    const keys = [cfg().iconKey, "LanguageIcon", "TranslateIcon"].filter(Boolean);
    for (const key of keys) {
      const comp = safe(() => (findByProps(key) || {})[key], null);
      if (comp) {
        try { const el = React.createElement(comp, { size: "md" }); return el; } catch (_) {}
      }
    }
    return null;
  }

  function iconAsImage(C) {
    const saved = cfg().iconSource;
    const id = (typeof saved === "number" ? saved : null) || translateAssetId();
    if (!id) return null;
    return React.createElement(RN.Image, { source: id, style: { width: 24, height: 24, tintColor: C.text } });
  }

  function translateIcon(C) {
    let el = iconAsComponent();
    if (!el && capturedIcon && React.isValidElement(capturedIcon)) el = capturedIcon;
    if (!el) el = iconAsImage(C);
    if (el) return el;
    return React.createElement(RN.Text, { style: { fontSize: 20, textAlign: "center" } }, "\uD83C\uDF10");
  }

  function TranslateButton(props) {
    const h = React.createElement;
    const [open, setOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [view, setView] = React.useState("main");
    const [from, setFrom] = React.useState("auto");
    const [to, setTo] = React.useState("en");
    const [query, setQuery] = React.useState("");
    const [, tick] = React.useState(0);
    React.useEffect(() => {
      const f = () => tick((x) => x + 1);
      buttonListeners.add(f);
      return () => { buttonListeners.delete(f); };
    }, []);
    const selected = armed != null || !!cfg().translateOnSend;
    if (cfg().showButton === false) return null;
    const C = palette();

    const run = (tl, sl) => {
      if (busy) return;
      setBusy(true);
      let p;
      try { p = translateInput({ tl, sl }); } catch (_) { p = Promise.resolve(); }
      return p.then(() => setBusy(false), () => setBusy(false));
    };
    const close = () => { setOpen(false); setView("main"); setQuery(""); };
    const openPanel = () => { setFrom(cfg().sourceOut || "auto"); setTo(cfg().targetOut || "en"); setView("main"); setOpen(true); };

    const row = (key, label, value, onPress) =>
      h(RN.Pressable, { key, onPress, style: { paddingVertical: 12, flexDirection: "row", justifyContent: "space-between" } },
        h(RN.Text, { style: { color: C.text, fontSize: 16 } }, label),
        h(RN.Text, { style: { color: C.sub, fontSize: 16 } }, value));

    const button = (key, title, onPress, color) =>
      h(RN.View, { key, style: { paddingVertical: 4 } }, h(RN.Button, { title, onPress, color }));

    let panel;
    if (view === "main") {
      const favs = (cfg().favLangs || []).filter((c) => LANG_NAME.has(c));
      panel = [
        h(RN.Text, { key: "t", style: { color: C.text, fontSize: 18, fontWeight: "700" } }, "Translate once"),
        h(RN.Text, { key: "s", style: { color: C.sub, fontSize: 13, marginBottom: 8 } }, "Does not change your saved settings"),
        row("from", "From", langName(from), () => { setQuery(""); setView("from"); }),
        row("to", "To", langName(to), () => { setQuery(""); setView("to"); }),
        favs.length
          ? h(RN.ScrollView, { key: "favs", horizontal: true, style: { marginVertical: 8 } },
              ...favs.map((c) => h(RN.Pressable, {
                key: c,
                onPress: () => setTo(c),
                style: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, marginRight: 8, backgroundColor: c === to ? ACCENT : C.card },
              }, h(RN.Text, { style: { color: c === to ? "#000" : C.text } }, langName(c)))))
          : null,
        button("go", busy ? "Translating..." : "Translate", () => { close(); run(to, from); }),
        lastOriginal != null ? button("undo", "Restore original text", () => { close(); restoreOriginal(); }) : null,
        button("cancel", "Close", close),
      ];
    } else {
      const q = query.trim().toLowerCase();
      const list = (view === "from" ? [["auto", "Auto-detect"]] : []).concat(LANGS)
        .filter(([c, n]) => !q || n.toLowerCase().indexOf(q) !== -1 || c.toLowerCase().indexOf(q) !== -1);
      panel = [
        button("back", "< Back", () => setView("main")),
        h(RN.TextInput, {
          key: "q", value: query, onChangeText: setQuery, placeholder: "Search languages", placeholderTextColor: C.sub,
          autoCorrect: false, autoCapitalize: "none",
          style: { color: C.text, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 10, marginVertical: 8 },
        }),
        h(RN.ScrollView, { key: "list", style: { maxHeight: 320 } },
          ...list.map(function (entry) {
            const code = entry[0];
            const label = entry[1];
            const mode = view;
            return h(RN.Pressable, {
              key: code,
              onPress: function () { if (mode === "from") setFrom(code); else setTo(code); setView("main"); },
              style: { paddingVertical: 11 },
            }, h(RN.Text, { style: { color: (mode === "from" ? from : to) === code ? ACCENT : C.text, fontSize: 16 } }, label));
          })),
      ];
    }

    const wrapperStyle = { marginRight: 6 };
    const buttonStyle = { width: 40, height: 40, borderRadius: 20, backgroundColor: selected ? "#5865F2" : C.card, alignItems: "center", justifyContent: "center" };
    return h(RN.View, { style: wrapperStyle },
      h(RN.Pressable, {
        onPress: () => {
          if (armed) { armed = null; notifyButton(); toast("Translation cancelled"); return; }
          run(cfg().targetOut || "en", cfg().sourceOut || "auto");
        },
        onLongPress: openPanel,
        delayLongPress: 350,
        style: [buttonStyle, { alignItems: "center", justifyContent: "center", opacity: busy ? 0.5 : 1 }],
        accessibilityLabel: "Translate message",
      }, translateIcon(C)),
      open
        ? h(RN.Modal, { visible: true, transparent: true, animationType: "slide", onRequestClose: close },
            h(RN.Pressable, { style: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }, onPress: close },
              h(RN.Pressable, {
                onPress: () => {},
                style: { backgroundColor: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 },
              }, ...panel)))
        : null);
  }

  const ANCHORS = [
    { id: "actions", label: "Next to the + button", name: "ChatInputActions", mode: "append" },
    { id: "send", label: "Next to the Send button", name: "ChatInputSendButton", mode: "beside" },
  ];
  const currentAnchor = () => ANCHORS.find((a) => a.id === cfg().anchor) || ANCHORS[0];
  const hiddenNames = () => {
    const keep = currentAnchor().name;
    return ["ChatInputActionButtonApps", "ChatInputActionButtonGiftOrThread", "ChatInputActionButtonGift"].filter((n) => n !== keep);
  };

  function resolveTarget(name) {
    const mod = findComponentModule(name);
    if (!mod) return null;
    const comp = mod.default && nameOfComponent(mod.default) === name ? mod.default : mod;
    return typeof comp === "function" ? (mod.default === comp ? [mod, "default"] : null) : patchTarget(comp);
  }

  function holdsHidden(node, depth, names) {
    if (!node || typeof node !== "object" || depth > 5) return false;
    if (Array.isArray(node)) return node.some((c) => holdsHidden(c, depth + 1, names));
    if (!node.$$typeof) return false;
    if (names.indexOf(nameOfComponent(node.type)) !== -1) return true;
    const p = node.props;
    return !!p && Object.keys(p).some((k) => holdsHidden(p[k], depth + 1, names));
  }

  // ---------- give the hidden buttons' space to the chat box ----------
  // Discord keeps the width of the hidden Gift and Apps slots, so the chat box stays narrow.
  // The left button group is shrunk by those two slots (40pt button + 8pt gap each).
  const RECLAIM = 96;

  function ReclaimWrap(props) {
    const h = React.createElement;
    const [natural, setNatural] = React.useState(0);
    // Never shrink below one button, and do nothing while Discord has the group collapsed.
    const width = natural > 0 ? Math.max(natural - RECLAIM, Math.min(natural, 48)) : undefined;
    return h(RN.View, { style: { flexShrink: 0, flexGrow: 0, alignSelf: props.align, width } },
      h(RN.View, {
        onLayout: (e) => { const w = Math.round(e.nativeEvent.layout.width); if (w !== natural) setNatural(w); },
        style: { flexShrink: 0, alignSelf: "flex-start" },
      }, props.children));
  }

  function installReclaim() {
    const target = resolveTarget("ChatInputActions");
    if (!target) return;
    unpatches.push(patcher.after(target[1], target[0], (args, ret) => {
      if (!ret || cfg().reclaim === false || cfg().hideExtras === false) return undefined;
      const st = safe(() => RN.StyleSheet.flatten(ret.props && ret.props.style), null);
      return React.createElement(ReclaimWrap, { align: st && st.alignSelf }, ret);
    }));
  }

  function hideChatButtons() {
    const names = hiddenNames();
    try {
      const target = resolveTarget("ChatInputActionButtonTransitionItem");
      if (target) {
        unpatches.push(patcher.instead(target[1], target[0], (args, orig) => {
          const props = args[0];
          if (cfg().hideExtras !== false && props && typeof props === "object") {
            const names = hiddenNames();
            if (Object.keys(props).some((k) => holdsHidden(props[k], 0, names))) return null;
          }
          return orig(...args);
        }));
      }
    } catch (_) {}
    for (const name of names) {
      try {
        const target = resolveTarget(name);
        if (!target) continue;
        unpatches.push(patcher.instead(target[1], target[0], (args, orig) => (cfg().hideExtras === false ? orig(...args) : null)));
      } catch (_) {}
    }
  }

  function attachButton() {
    const anchor = currentAnchor();
    const target = resolveTarget(anchor.name);
    if (!target) return;
    const row = (...kids) => React.createElement(RN.View, { style: { flexDirection: "row", alignItems: "center" } }, ...kids);
    try {
      unpatches.push(patcher.after(target[1], target[0], (args, ret) => {
        if (cfg().showButton === false || !ret) return undefined;
        const button = React.createElement(TranslateButton, { key: "qt-button" });
        return anchor.mode === "beside" ? row(button, ret) : row(ret, button);
      }));
    } catch (_) {}
  }

  // ---------- settings ----------
  function Settings() {
    vstorage.useProxy(plugin.storage);
    const [screen, setScreen] = React.useState("main");
    const [query, setQuery] = React.useState("");
    const [, bump] = React.useState(0);
    const refreshUI = () => bump((x) => x + 1);
    const F = ui.components && ui.components.Forms;
    const C = palette();
    const h = React.createElement;

    const Text = (props, ...kids) => h(RN.Text, props, ...kids);
    const Section = (title) =>
      h(RN.View, { key: "sec-" + title, style: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 4 } },
        Text({ style: { color: C.sub, fontSize: 12, fontWeight: "600" } }, title.toUpperCase()));
    const PressRow = (key, label, sub, onPress, right, rightColor) =>
      h(RN.Pressable, { key, onPress, style: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center" } },
        h(RN.View, { style: { flex: 1 } },
          Text({ style: { color: C.text, fontSize: 16 } }, label),
          sub ? Text({ style: { color: C.sub, fontSize: 13, marginTop: 2 } }, sub) : null),
        right ? Text({ style: { color: rightColor || C.sub, fontSize: 15, marginLeft: 8 } }, right) : null);
    const Switch = (key, label, sub) => {
      const value = !!cfg()[key];
      const change = (v) => { cfg()[key] = v; refreshUI(); notifyButton(); };
      return F && F.FormSwitchRow
        ? h(F.FormSwitchRow, { key, label, subLabel: sub, value, onValueChange: change })
        : h(RN.View, { key, style: { flexDirection: "row", alignItems: "center", padding: 16 } },
            h(RN.View, { style: { flex: 1 } },
              Text({ style: { color: C.text, fontSize: 16 } }, label),
              Text({ style: { color: C.sub, fontSize: 13 } }, sub)),
            h(RN.Switch, { value, onValueChange: change }));
    };
    const Btn = (key, title, onPress) =>
      h(RN.View, { key, style: { paddingHorizontal: 16, paddingVertical: 6 } }, h(RN.Button, { title, onPress }));
    const Search = () =>
      h(RN.TextInput, {
        key: "search", value: query, onChangeText: setQuery, placeholder: "Search languages", placeholderTextColor: C.sub,
        autoCorrect: false, autoCapitalize: "none",
        style: { color: C.text, borderWidth: 1, borderColor: C.line, borderRadius: 8, padding: 10, marginHorizontal: 16, marginVertical: 8 },
      });
    const filtered = (extra) => {
      const q = query.trim().toLowerCase();
      return (extra || []).concat(LANGS).filter(([c, n]) => !q || n.toLowerCase().indexOf(q) !== -1 || c.toLowerCase().indexOf(q) !== -1);
    };
    const back = () => Btn("back", "< Back", () => { setScreen("main"); setQuery(""); });

    let content;
    if (screen === "targetOut" || screen === "targetIn" || screen === "sourceOut") {
      const isSource = screen === "sourceOut";
      content = [back(), Search()];
      const target = screen;
      filtered(isSource ? [["auto", "Auto-detect"]] : []).forEach(function (entry) {
        const code = entry[0];
        const label = entry[1];
        content.push(PressRow(code, label, code === "auto" ? "Detect the language automatically" : code, function () {
          cfg()[target] = code;
          setScreen("main");
          setQuery("");
        }, cfg()[target] === code ? "Selected" : ""));
      });
    } else if (screen === "favs") {
      const favs = cfg().favLangs || [];
      content = [back(), Search(),
        Text({ key: "hint", style: { color: C.sub, fontSize: 13, paddingHorizontal: 16 } }, "Pick up to " + MAX_FAVS + ". They appear in the \"Translate to...\" menu and in the chat bar panel.")];
      filtered().forEach(function (entry) {
        const code = entry[0];
        const label = entry[1];
        const on = favs.indexOf(code) !== -1;
        content.push(PressRow(code, label, code, function () {
          if (on) cfg().favLangs = favs.filter((x) => x !== code);
          else if (favs.length < MAX_FAVS) cfg().favLangs = favs.concat([code]);
          else toast("You can pick up to " + MAX_FAVS);
          refreshUI();
        }, on ? "Selected" : ""));
      });
    } else {
      content = [
        Section("Languages"),
        PressRow("out", "Translate my messages to", "Used by the chat bar button and \"Translate on send\"", () => setScreen("targetOut"), langName(cfg().targetOut)),
        PressRow("src", "My messages are written in", "Auto-detect is recommended", () => setScreen("sourceOut"), langName(cfg().sourceOut)),
        PressRow("in", "Translate messages to", "Used when you translate a message from its menu", () => setScreen("targetIn"), langName(cfg().targetIn)),
        PressRow("favs", "Quick languages", "Shown in the one-time menus", () => setScreen("favs"), (cfg().favLangs || []).length + " selected"),
        Section("Display"),
        Switch("immersive", "Immersive translation", "Show the translation below the original message. Off replaces the original text"),
        PressRow("color", "Translation color", "Color of the translated text in messages", () => {
          try {
            ui.alerts.showCustomAlert(ColorModal, {
              initialValue: translationColor(),
              onSave: (hex) => { cfg().translationColor = hex; refreshUI(); refreshTranslated(); },
            });
          } catch (_) { toast("Could not open color settings"); }
        }, translationColor(), translationColor()),
        Section("Chat bar"),
        Switch("showButton", "Show translate button in chat box", "Turn off to only translate messages from their long-press menu"),
        Switch("translateOnSend", "Translate on send", "Translate every message right before it is sent"),
        PressRow("anchor", "Button position", "Tap to change, then restart Discord", () => {
          const i = ANCHORS.findIndex((x) => x.id === currentAnchor().id);
          cfg().anchor = ANCHORS[(i + 1) % ANCHORS.length].id;
          refreshUI();
        }, currentAnchor().label),
        Switch("hideExtras", "Hide Gift and Apps buttons", "Removes them from the chat bar. Restart Discord to apply"),
        Switch("reclaim", "Expand chat box over hidden buttons", "The chat box takes the space the hidden buttons left. Restart Discord to apply"),
      ];
    }
    content.unshift(h(RN.View, { key: "build", style: { paddingHorizontal: 16, paddingTop: 8 } },
      Text({ style: { color: C.sub, fontSize: 11 } }, "Build " + BUILD)));
    return h(RN.ScrollView, { key: screen }, ...content);
  }

  const step = (fn) => { try { fn(); } catch (_) {} };

  function onLoad() {
    const s = cfg();
    const defaults = {
      targetOut: "en", targetIn: "en", sourceOut: "auto", immersive: true, translationColor: ACCENT, showButton: true,
      translateOnSend: false, hideExtras: true, reclaim: true, anchor: "actions", favLangs: ["en", "es", "fr", "de", "ro", "ru"],
    };
    for (const k of Object.keys(defaults)) if (s[k] === undefined) s[k] = defaults[k];
    if (!ANCHORS.some((a) => a.id === s.anchor)) s.anchor = "actions";
    renderErrors = 0;
    step(loadStores);
    step(() => { renderUnpatch = patchRender(); });
    step(() => {
      ActionSheet = findByProps("openLazy", "hideActionSheet");
      if (ActionSheet) unpatches.push(patcher.before("openLazy", ActionSheet, hookSheet));
    });
    step(installInputCapture);
    step(installSendHook);
    step(installReclaim);
    step(attachButton);
    step(hideChatButtons);
  }

  function onUnload() {
    for (const u of unpatches.splice(0)) { try { u(); } catch (_) {} }
    if (renderUnpatch) { try { renderUnpatch(); } catch (_) {} renderUnpatch = null; }
    translations.clear();
    cache.clear();
    bridge.text = "";
    bridge.change = null;
    bridge.inst = null;
    armed = null;
    lastOriginal = null;
  }

  return { onLoad, onUnload, settings: Settings };
})()
