(function () {
  const NS = (window.__kanbanBoard = window.__kanbanBoard || {});

  NS.el = function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, "");
      else if (v !== false && v != null) node.setAttribute(k, String(v));
    }
    for (const c of children)
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return node;
  };

  NS.byId = function byId(id) {
    return document.getElementById(id);
  };

  NS.formatDate = function formatDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  NS.debounce = function debounce(fn, delayMs) {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delayMs);
    };
  };

  NS.getFocusable = function getFocusable(container) {
    if (!container) return [];
    const all = Array.from(
      container.querySelectorAll(
        'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"])',
      ),
    );
    return all.filter((el) => {
      const disabled = el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
      if (disabled) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return true;
    });
  };
})();
