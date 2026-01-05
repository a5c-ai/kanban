(function () {
  const vscode = acquireVsCodeApi();
  const NS = (window.__kanbanBoard = window.__kanbanBoard || {});

  /** @type {Map<string, {msg:any, trackBusy:boolean}>} */
  const pending = new Map();
  let seq = 0;

  function newRequestId() {
    seq += 1;
    return `${Date.now()}-${seq}-${Math.random().toString(16).slice(2)}`;
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  function send(msg, { trackBusy = true } = {}) {
    const requestId = newRequestId();
    const wrapped = { ...msg, requestId };
    pending.set(requestId, { msg, trackBusy });
    post(wrapped);
    NS.onPendingChanged?.(getBusyCount());
    return requestId;
  }

  function getBusyCount() {
    let n = 0;
    for (const p of pending.values()) if (p.trackBusy) n += 1;
    return n;
  }

  function isBusy() {
    return getBusyCount() > 0;
  }

  function showActionToast({ level, message, actions = [] }) {
    const existing = document.querySelector(".banner.toast");
    if (existing) existing.remove();

    const actionRow = NS.el("div", { class: "toastActions" }, []);
    for (const a of actions) {
      actionRow.appendChild(
        NS.el(
          "button",
          {
            class: a.primary ? "btn primary" : "btn",
            onClick: () => {
              try {
                a.onClick?.();
              } finally {
                const cur = document.querySelector(".banner.toast");
                if (cur) cur.remove();
              }
            },
          },
          [a.label],
        ),
      );
    }

    const b = NS.el("div", { class: `banner toast ${level === "error" ? "error" : ""}` }, [
      NS.el("div", { class: "toastMsg", text: (level === "error" ? "Error: " : "") + message }),
      actions.length > 0 ? actionRow : NS.el("div"),
    ]);
    NS.byId("app").prepend(b);
  }

  function handleOpResult(msg) {
    const entry = pending.get(msg.requestId);
    if (entry) pending.delete(msg.requestId);
    NS.onPendingChanged?.(getBusyCount());

    if (msg.ok) return;
    const err = msg.error || "Operation failed";

    const safeToRetry = !!msg.safeToRetry;
    const looksLikeConflict = /conflict/i.test(err) || /diverg/i.test(err) || /merge/i.test(err);

    /** @type {Array<{label:string, primary?:boolean, onClick?:()=>void}>} */
    const actions = [];
    if (looksLikeConflict) {
      actions.push({
        label: "Reload latest",
        primary: !safeToRetry,
        onClick: () => {
          send({ type: "refresh" }, { trackBusy: false });
        },
      });
    }
    if (safeToRetry && entry) {
      actions.push({
        label: "Retry",
        primary: !looksLikeConflict,
        onClick: () => {
          send(entry.msg, { trackBusy: entry.trackBusy });
        },
      });
    }
    actions.push({ label: "Dismiss" });

    showActionToast({
      level: "error",
      message: looksLikeConflict ? `${err} (Try “Reload latest”.)` : err,
      actions,
    });
  }

  NS.protocol = {
    post,
    send,
    isBusy,
    handleOpResult,
    showActionToast,
  };
})();
