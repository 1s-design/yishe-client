const boundPages = new WeakSet();
const boundContexts = new WeakSet();

function normalizePayload(payload = {}) {
  const profileId = String(payload?.profileId || payload?.environmentId || "").trim() || "default";
  const profileName =
    String(payload?.profileName || payload?.environmentName || profileId).trim() || profileId;
  const openedAtText = String(payload?.openedAtText || "").trim();

  return {
    profileId,
    profileName,
    openedAtText,
  };
}

export function formatBrowserRuntimeTimestamp(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || "").trim();
  }

  const pad = (input) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

export function isRuntimeOptionalPageUrl(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "about:blank" ||
    normalized === "chrome://newtab/" ||
    normalized === "chrome://new-tab-page/" ||
    normalized === "chrome-search://local-ntp/local-ntp.html" ||
    normalized === "edge://newtab/"
  );
}

export function injectBrowserPageRuntime(rawPayload = {}) {
  const runtimeHeartbeatInterval = 8_000;
  const badgePulseMinGap = 1_600;
  const normalizeText = (value, fallback = "") => {
    const normalized = String(value || "").trim();
    return normalized || fallback;
  };

  const normalizeRuntimePayload = (nextPayload = {}) => {
    return {
      profileId: normalizeText(nextPayload?.profileId || nextPayload?.environmentId, "default"),
      profileName: normalizeText(
        nextPayload?.profileName || nextPayload?.environmentName,
        normalizeText(nextPayload?.profileId || nextPayload?.environmentId, "default"),
      ),
      openedAtText: normalizeText(nextPayload?.openedAtText, ""),
    };
  };

  const BADGE_ID = "__yishe_browser_automation_profile_badge";
  const BADGE_VERSION = "9";
  const badgeState =
    (globalThis.__yisheBrowserAutomationProfileBadgeState =
      globalThis.__yisheBrowserAutomationProfileBadgeState || {});

  const applyRuntimePayload = (nextPayload = {}) => {
    const normalizedPayload = normalizeRuntimePayload(nextPayload);
    badgeState.payload = normalizedPayload;
    globalThis.__yisheBrowserAutomationProfile = normalizedPayload;
    return normalizedPayload;
  };

  const isPingReason = (reason = "") => reason === "heartbeat" || reason === "probe";
  const payload = applyRuntimePayload(rawPayload);

  const ensureFocusState = () => {
    const prev = globalThis.__yisheFocusTracker || {};
    const now = Date.now();
    const next = {
      hasFocus: typeof document?.hasFocus === "function" ? document.hasFocus() : false,
      visibilityState: document?.visibilityState || "unknown",
      lastFocusAt: Number(prev.lastFocusAt || 0),
      lastBlurAt: Number(prev.lastBlurAt || 0),
      lastVisibleAt: Number(prev.lastVisibleAt || 0),
      updatedAt: now,
      lastReason: prev.lastReason || "sync",
    };

    if (next.hasFocus && !next.lastFocusAt) {
      next.lastFocusAt = now;
    }
    if (next.visibilityState === "visible" && !next.lastVisibleAt) {
      next.lastVisibleAt = now;
    }

    globalThis.__yisheFocusTracker = next;
    return next;
  };

  const updateFocusState = (reason = "update") => {
    const prev = ensureFocusState();
    const now = Date.now();
    const next = {
      ...prev,
      hasFocus: typeof document?.hasFocus === "function" ? document.hasFocus() : false,
      visibilityState: document?.visibilityState || "unknown",
      updatedAt: now,
      lastReason: reason,
    };

    if (reason === "focus" || next.hasFocus) {
      next.lastFocusAt = now;
    }
    if (reason === "blur") {
      next.lastBlurAt = now;
    }
    if (reason === "visible" || next.visibilityState === "visible") {
      next.lastVisibleAt = now;
    }

    globalThis.__yisheFocusTracker = next;
    return next;
  };

  const touchRuntimeState = (reason = "update") => {
    const prev = globalThis.__yisheBrowserRuntime || {};
    const now = Date.now();
    const next = {
      ...prev,
      profileId: payload.profileId,
      profileName: payload.profileName,
      openedAtText: payload.openedAtText,
      href: typeof location !== "undefined" ? location.href || "" : "",
      title: typeof document !== "undefined" ? document.title || "" : "",
      readyState: typeof document !== "undefined" ? document.readyState || "unknown" : "unknown",
      updatedAt: now,
      lastHeartbeatAt: isPingReason(reason) ? now : Number(prev.lastHeartbeatAt || 0),
      lastReason: reason,
    };

    if (!next.startedAt) {
      next.startedAt = now;
    }
    if (!next.lastHeartbeatAt) {
      next.lastHeartbeatAt = now;
    }

    globalThis.__yisheBrowserRuntime = next;
    return next;
  };

  const ensureBadge = () => {
    if (!document?.documentElement) {
      return;
    }

    const mountTarget = document.body || document.documentElement;
    if (!mountTarget) {
      return;
    }

    let badge = document.getElementById(BADGE_ID);
    if (badge && badge.dataset.version !== BADGE_VERSION) {
      badge.remove();
      badge = null;
    }

    if (!badge) {
      badge = document.createElement("div");
      badge.id = BADGE_ID;
      badge.dataset.version = BADGE_VERSION;
      badge.setAttribute("data-yishe-browser-automation", "profile-badge");
      badge.setAttribute("aria-hidden", "true");
      badge.style.cssText = [
        "position:fixed",
        "right:10px",
        "bottom:10px",
        "z-index:2147483647",
        "pointer-events:none",
        "width:156px",
        "padding:0",
        "border-radius:8px",
        "background:transparent",
        "overflow:visible",
        "font-family:'SF Pro Text','Segoe UI',Arial,sans-serif",
        "user-select:none",
        "box-sizing:border-box",
      ].join(";");

      const glow = document.createElement("div");
      glow.setAttribute("data-role", "glow");
      glow.style.cssText = [
        "position:absolute",
        "inset:0",
        "border-radius:8px",
        "background:transparent",
        "filter:none",
        "opacity:0",
        "z-index:0",
        "pointer-events:none",
        "display:none",
      ].join(";");

      const cardInfo = document.createElement("div");
      cardInfo.setAttribute("data-role", "card-info");
      cardInfo.style.cssText = [
        "position:relative",
        "z-index:1",
        "display:flex",
        "flex-direction:column",
        "gap:3px",
        "width:100%",
        "min-height:68px",
        "padding:7px 9px",
        "border-radius:8px",
        "background:rgba(18,18,18,0.94)",
        "border:1px solid rgba(255,255,255,0.08)",
        "box-sizing:border-box",
        "color:#f8fafc",
      ].join(";");

      const headerRow = document.createElement("div");
      headerRow.setAttribute("data-role", "header");
      headerRow.style.cssText = [
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "gap:8px",
        "width:100%",
      ].join(";");

      const eyebrow = document.createElement("div");
      eyebrow.setAttribute("data-role", "eyebrow");
      eyebrow.style.cssText = [
        "font-size:8px",
        "font-weight:600",
        "letter-spacing:0.06em",
        "color:rgba(255,255,255,0.56)",
        "text-transform:uppercase",
        "line-height:1.2",
      ].join(";");
      eyebrow.textContent = "环境编号";

      const status = document.createElement("div");
      status.setAttribute("data-role", "status");
      status.style.cssText = [
        "position:relative",
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "width:16px",
        "height:16px",
        "flex:0 0 auto",
      ].join(";");
      status.title = "运行时心跳";

      const pulseHalo = document.createElement("span");
      pulseHalo.setAttribute("data-role", "pulseHalo");
      pulseHalo.style.cssText = [
        "position:absolute",
        "inset:0",
        "border-radius:999px",
        "background:rgba(34,197,94,0.32)",
        "transform:scale(0.68)",
        "opacity:0",
      ].join(";");

      const pulseDot = document.createElement("span");
      pulseDot.setAttribute("data-role", "pulseDot");
      pulseDot.style.cssText = [
        "position:relative",
        "display:block",
        "width:10px",
        "height:10px",
        "border-radius:999px",
        "background:#22c55e",
        "box-shadow:0 0 0 1px rgba(34,197,94,0.18), 0 0 8px rgba(34,197,94,0.28)",
      ].join(";");

      status.appendChild(pulseHalo);
      status.appendChild(pulseDot);
      headerRow.appendChild(eyebrow);
      headerRow.appendChild(status);

      const number = document.createElement("div");
      number.setAttribute("data-role", "number");
      number.style.cssText = [
        "font-size:17px",
        "font-weight:700",
        "line-height:1.1",
        "color:#ffffff",
        "letter-spacing:0.02em",
      ].join(";");

      const name = document.createElement("div");
      name.setAttribute("data-role", "name");
      name.style.cssText = [
        "font-size:9px",
        "font-weight:500",
        "line-height:1.25",
        "color:rgba(255,255,255,0.82)",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "white-space:nowrap",
      ].join(";");

      const openedAt = document.createElement("div");
      openedAt.setAttribute("data-role", "openedAt");
      openedAt.style.cssText = [
        "font-size:9px",
        "font-weight:500",
        "line-height:1.25",
        "color:rgba(255,255,255,0.64)",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "white-space:nowrap",
      ].join(";");

      cardInfo.appendChild(headerRow);
      cardInfo.appendChild(number);
      cardInfo.appendChild(name);
      cardInfo.appendChild(openedAt);
      badge.appendChild(glow);
      badge.appendChild(cardInfo);
      mountTarget.appendChild(badge);
    } else if (badge.parentElement !== mountTarget) {
      mountTarget.appendChild(badge);
    }

    const currentPayload = badgeState.payload || payload;
    badge.dataset.profileId = currentPayload.profileId || "";
    badge.dataset.profileName = currentPayload.profileName || "";
    badge.title = [currentPayload.profileId, currentPayload.profileName, currentPayload.openedAtText]
      .filter(Boolean)
      .join(" | ");

    const numberNode = badge.querySelector('[data-role="number"]');
    const nameNode = badge.querySelector('[data-role="name"]');
    const openedAtNode = badge.querySelector('[data-role="openedAt"]');
    if (numberNode) {
      numberNode.textContent = currentPayload.profileId || "default";
    }
    if (nameNode) {
      nameNode.textContent = `环境名称 ${currentPayload.profileName || currentPayload.profileId || "--"}`;
    }
    if (openedAtNode) {
      openedAtNode.textContent = currentPayload.openedAtText ? `打开时间 ${currentPayload.openedAtText}` : "";
    }
  };

  const triggerBadgePulse = (reason = "probe") => {
    if (!isPingReason(reason)) {
      return;
    }

    const now = Date.now();
    if (now - Number(badgeState.lastPulseAt || 0) < badgePulseMinGap) {
      return;
    }
    badgeState.lastPulseAt = now;

    const badge = document.getElementById(BADGE_ID);
    const pulseDot = badge?.querySelector('[data-role="pulseDot"]');
    const pulseHalo = badge?.querySelector('[data-role="pulseHalo"]');
    if (!pulseDot || !pulseHalo) {
      return;
    }

    try {
      if (typeof pulseDot.getAnimations === "function") {
        pulseDot.getAnimations().forEach((animation) => animation.cancel());
      }
      if (typeof pulseHalo.getAnimations === "function") {
        pulseHalo.getAnimations().forEach((animation) => animation.cancel());
      }
    } catch {
      // ignore
    }

    if (typeof pulseDot.animate === "function") {
      pulseDot.animate(
        [
          { transform: "scale(1)", opacity: 1, boxShadow: "0 0 0 1px rgba(34,197,94,0.18), 0 0 8px rgba(34,197,94,0.28)" },
          { transform: "scale(1.28)", opacity: 1, boxShadow: "0 0 0 2px rgba(34,197,94,0.14), 0 0 10px rgba(34,197,94,0.34)" },
          { transform: "scale(1.08)", opacity: 1, boxShadow: "0 0 0 1px rgba(34,197,94,0.12), 0 0 8px rgba(34,197,94,0.24)" },
          { transform: "scale(1)", opacity: 1, boxShadow: "0 0 0 1px rgba(34,197,94,0.18), 0 0 8px rgba(34,197,94,0.28)" },
        ],
        {
          duration: 760,
          easing: "ease-out",
        },
      );
    }

    if (typeof pulseHalo.animate === "function") {
      pulseHalo.animate(
        [
          { transform: "scale(0.72)", opacity: 0.34 },
          { transform: "scale(2.15)", opacity: 0 },
        ],
        {
          duration: 900,
          easing: "ease-out",
        },
      );
    }
  };

  const syncRuntime = (reason = "sync") => {
    updateFocusState(reason);
    touchRuntimeState(reason);
    ensureBadge();
    triggerBadgePulse(reason);
  };

  globalThis.__yisheBrowserRuntimeProbe = (nextPayload = null) => {
    if (nextPayload && typeof nextPayload === "object") {
      applyRuntimePayload(nextPayload);
    }
    syncRuntime("probe");
    const focusState = globalThis.__yisheFocusTracker || {};
    const runtimeState = globalThis.__yisheBrowserRuntime || {};
    const runtimePayload = globalThis.__yisheBrowserAutomationProfile || badgeState.payload || payload;
    return {
      profileId: runtimePayload.profileId || "",
      profileName: runtimePayload.profileName || "",
      title: runtimeState.title || "",
      url: runtimeState.href || "",
      readyState: runtimeState.readyState || "unknown",
      hasFocus: !!focusState.hasFocus,
      visibilityState: focusState.visibilityState || "unknown",
      lastFocusAt: Number(focusState.lastFocusAt || 0),
      lastBlurAt: Number(focusState.lastBlurAt || 0),
      lastVisibleAt: Number(focusState.lastVisibleAt || 0),
      updatedAt: Number(focusState.updatedAt || runtimeState.updatedAt || 0),
      lastHeartbeatAt: Number(runtimeState.lastHeartbeatAt || runtimeState.updatedAt || 0),
      lastProbeAt: Number(runtimeState.lastProbeAt || 0),
    };
  };

  syncRuntime("init");

  if (globalThis.__yisheBrowserRuntimeInstalled) {
    return;
  }

  globalThis.__yisheBrowserRuntimeInstalled = true;

  const safeSync = (reason) => {
    try {
      syncRuntime(reason);
    } catch {
      // ignore
    }
  };

  window.addEventListener("focus", () => safeSync("focus"), true);
  window.addEventListener("blur", () => safeSync("blur"), true);
  window.addEventListener("pageshow", () => safeSync("pageshow"), true);
  window.addEventListener("load", () => safeSync("load"), true);
  document.addEventListener(
    "visibilitychange",
    () => safeSync(document.visibilityState === "visible" ? "visible" : "hidden"),
    true,
  );

  if (!globalThis.__yisheBrowserRuntimeHeartbeatId && typeof window?.setInterval === "function") {
    globalThis.__yisheBrowserRuntimeHeartbeatId = window.setInterval(
      () => safeSync("heartbeat"),
      runtimeHeartbeatInterval,
    );
  }

  if (typeof MutationObserver === "function" && document?.documentElement && !badgeState.observer) {
    const observer = new MutationObserver(() => {
      const badge = document.getElementById(BADGE_ID);
      if (!badge || !badge.isConnected) {
        safeSync("mutation");
      }
    });

    try {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      badgeState.observer = observer;
    } catch {
      // ignore
    }
  }
}

export async function installBrowserPageRuntimeForPage(page, payload = {}) {
  if (!page || (typeof page.isClosed === "function" && page.isClosed())) {
    return;
  }

  try {
    await page.evaluate(injectBrowserPageRuntime, normalizePayload(payload));
  } catch {
    // 页面导航中、特殊页面或内部页面时忽略
  }
}

function bindPageRuntime(page, resolvePayload) {
  if (!page || boundPages.has(page)) {
    return;
  }

  boundPages.add(page);

  const syncRuntime = () => {
    const payload =
      typeof resolvePayload === "function" ? resolvePayload() : resolvePayload || {};
    void installBrowserPageRuntimeForPage(page, payload);
  };

  page.on("domcontentloaded", syncRuntime);
  page.on("load", syncRuntime);
}

export async function installBrowserPageRuntime(context, payloadOrResolver, options = {}) {
  if (!context) {
    return;
  }

  const resolvePayload = () => {
    const nextPayload =
      typeof payloadOrResolver === "function" ? payloadOrResolver() : payloadOrResolver || {};
    return normalizePayload(nextPayload);
  };

  try {
    if (!boundContexts.has(context)) {
      boundContexts.add(context);
      await context.addInitScript(injectBrowserPageRuntime, resolvePayload()).catch(() => {});
      context.on("page", (page) => {
        bindPageRuntime(page, resolvePayload);
        void installBrowserPageRuntimeForPage(page, resolvePayload());
      });
    }

    for (const page of typeof context.pages === "function" ? context.pages() : []) {
      bindPageRuntime(page, resolvePayload);
      await installBrowserPageRuntimeForPage(page, resolvePayload());
    }
  } catch (error) {
    options?.logger?.warn(options?.logLabel || "安装页面运行时失败:", error?.message || error);
  }
}

export async function probeBrowserPageRuntime(page, payload = {}) {
  if (!page || (typeof page.isClosed === "function" && page.isClosed())) {
    return null;
  }

  return await page.evaluate((nextPayload) => {
    if (typeof globalThis.__yisheBrowserRuntimeProbe === "function") {
      return globalThis.__yisheBrowserRuntimeProbe(nextPayload);
    }

    const normalizeText = (value, fallback = "") => {
      const normalized = String(value || "").trim();
      return normalized || fallback;
    };

    const payload = {
      profileId: normalizeText(nextPayload?.profileId || nextPayload?.environmentId, "default"),
      profileName: normalizeText(
        nextPayload?.profileName || nextPayload?.environmentName,
        normalizeText(nextPayload?.profileId || nextPayload?.environmentId, "default"),
      ),
      openedAtText: normalizeText(nextPayload?.openedAtText, ""),
    };

    globalThis.__yisheBrowserAutomationProfile = payload;
    const focusState = globalThis.__yisheFocusTracker || {};
    const runtimeState = globalThis.__yisheBrowserRuntime || {};
    const now = Date.now();
    const nextRuntime = {
      ...runtimeState,
      profileId: payload.profileId,
      profileName: payload.profileName,
      openedAtText: payload.openedAtText,
      href: typeof location !== "undefined" ? location.href || "" : "",
      title: typeof document !== "undefined" ? document.title || "" : "",
      readyState: typeof document !== "undefined" ? document.readyState || "unknown" : "unknown",
      updatedAt: now,
      lastProbeAt: now,
      lastReason: "probe",
      lastHeartbeatAt: now,
    };

    if (!nextRuntime.startedAt) {
      nextRuntime.startedAt = Number(runtimeState.startedAt || 0) || now;
    }

    globalThis.__yisheBrowserRuntime = nextRuntime;

    return {
      profileId: payload.profileId,
      profileName: payload.profileName,
      title: nextRuntime.title || "",
      url: nextRuntime.href || "",
      readyState: nextRuntime.readyState || "unknown",
      hasFocus: typeof document?.hasFocus === "function" ? document.hasFocus() : false,
      visibilityState: document?.visibilityState || "unknown",
      lastFocusAt: Number(focusState.lastFocusAt || 0),
      lastBlurAt: Number(focusState.lastBlurAt || 0),
      lastVisibleAt: Number(focusState.lastVisibleAt || 0),
      updatedAt: Number(focusState.updatedAt || nextRuntime.updatedAt || 0),
      lastHeartbeatAt: Number(nextRuntime.lastHeartbeatAt || nextRuntime.updatedAt || 0),
      lastProbeAt: Number(nextRuntime.lastProbeAt || 0),
    };
  }, normalizePayload(payload));
}
