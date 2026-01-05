(function () {
  const NS = (window.__kanbanBoard = window.__kanbanBoard || {});

  let restoreFocusSelector = null;

  NS.focus = {
    remember(selector) {
      restoreFocusSelector = selector || null;
    },
    restore() {
      if (!restoreFocusSelector) return;
      const el = document.querySelector(restoreFocusSelector);
      restoreFocusSelector = null;
      if (el && typeof el.focus === "function") el.focus();
    },
    focusFirst(container) {
      const focusable = NS.getFocusable(container);
      if (focusable.length > 0) focusable[0].focus();
    },
    trapTabKey(event, container) {
      if (event.key !== "Tab") return false;
      const focusable = NS.getFocusable(container);
      if (focusable.length === 0) return false;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
          return true;
        }
      } else {
        if (active === last) {
          event.preventDefault();
          first.focus();
          return true;
        }
      }
      return false;
    },
  };
})();

