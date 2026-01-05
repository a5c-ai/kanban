(function () {
  const NS = window.__kanbanBoard;
  const { el, byId, formatDate, debounce } = NS;
  const { protocol, focus } = NS;

  /** @type {import("./types").State | null} */
  let state = null;
  /** @type {string | undefined} */
  let activeBoardId = undefined;
  /** @type {{open:boolean, cardId?:string, history?:any[], openerFocusId?:string}} */
  let drawer = { open: false };
  /** @type {{open:boolean, kind?:'search'|'conflicts', payload?:any, openerFocusId?:string}} */
  let overlay = { open: false };
  let ui = {
    renamingBoard: false,
    newBoard: false,
    loading: true,
    stateError: false,
    pendingCount: 0,
    search: { query: "", loading: false, activeIndex: 0 },
  };

  function post(msg) {
    protocol.post(msg);
  }

  function send(msg, opts) {
    return protocol.send(msg, opts);
  }

  function updateBusyIndicator() {
    const node = document.querySelector('[data-role="busyIndicator"]');
    if (!node) return;
    if (ui.pendingCount > 0) {
      node.textContent = `Syncing… (${ui.pendingCount})`;
      node.setAttribute("aria-hidden", "false");
    } else {
      node.textContent = "";
      node.setAttribute("aria-hidden", "true");
    }
  }

  NS.onPendingChanged = (n) => {
    ui.pendingCount = n;
    updateBusyIndicator();
  };

  function toast(level, message) {
    protocol.showActionToast({ level, message, actions: [{ label: "Dismiss" }] });
  }

  let lastSearchSent = "";
  const debouncedSearch = debounce((raw) => {
    const q = (raw || "").trim();
    if (!q) {
      ui.search.loading = false;
      if (overlay.open && overlay.kind === "search") closeOverlay();
      return;
    }

    ui.search.loading = true;
    if (!overlay.open || overlay.kind !== "search") {
      openOverlay(
        "search",
        { query: q, results: [] },
        { openerFocusId: "search-input", takeFocus: false },
      );
      setTimeout(() => byId("q")?.focus(), 0);
    } else if (overlay.payload?.query !== q) {
      overlay.payload = { ...(overlay.payload || {}), query: q, results: [] };
      render();
      setTimeout(() => byId("q")?.focus(), 0);
    }

    if (q === lastSearchSent) return;
    lastSearchSent = q;
    send({ type: "searchCards", query: q }, { trackBusy: false });
  }, 250);

  function boardName(boardId) {
    const b = state?.boards?.[boardId];
    return b ? b.name : boardId;
  }

  function listName(listId) {
    const l = state?.lists?.[listId];
    return l ? l.name : listId;
  }

  function getActiveBoard() {
    if (!state) return null;
    const ids = Object.keys(state.boards || {});
    if (ids.length === 0) return null;
    if (!activeBoardId || !state.boards[activeBoardId])
      activeBoardId = ids.sort((a, b) =>
        state.boards[a].name.localeCompare(state.boards[b].name),
      )[0];
    return state.boards[activeBoardId];
  }

  function orderedLists(board) {
    if (!state || !board) return [];
    return (board.listIds || [])
      .map((id) => state.lists[id])
      .filter(Boolean)
      .sort((a, b) => (a.position || 0) - (b.position || 0) || a.id.localeCompare(b.id));
  }

  function orderedCards(list) {
    if (!state || !list) return [];
    return (list.cardIds || [])
      .map((id) => state.cards[id])
      .filter(Boolean)
      .sort((a, b) => (a.position || 0) - (b.position || 0) || a.id.localeCompare(b.id));
  }

  function showInfo(message) {
    protocol.showActionToast({ level: "info", message, actions: [{ label: "Dismiss" }] });
  }

  function openOverlay(kind, payload, { openerFocusId, takeFocus = true } = {}) {
    overlay = { open: true, kind, payload, openerFocusId };
    if (openerFocusId) focus.remember(`[data-focus-id="${openerFocusId}"]`);
    render();
    if (!takeFocus) return;
    setTimeout(() => {
      const panel = document.querySelector(".overlayPanel");
      focus.focusFirst(panel);
    }, 0);
  }

  function closeOverlay() {
    overlay = { open: false };
    render();
    focus.restore();
  }

  function openDrawer(cardId, openerFocusId) {
    drawer = { open: true, cardId, openerFocusId };
    if (openerFocusId) focus.remember(`[data-focus-id="${openerFocusId}"]`);
    send({ type: "getCardHistory", cardId }, { trackBusy: false });
    render();
    setTimeout(() => {
      const d = document.querySelector(".drawer");
      focus.focusFirst(d);
    }, 0);
  }

  function closeDrawer() {
    drawer = { open: false };
    render();
    focus.restore();
  }

  document.addEventListener("keydown", (e) => {
    if (drawer.open) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDrawer();
        return;
      }
      if (e.key === "Tab") {
        const d = document.querySelector(".drawer");
        if (d) focus.trapTabKey(e, d);
        return;
      }
    }
    if (overlay.open) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeOverlay();
        return;
      }
      if (e.key === "Tab") {
        const p = document.querySelector(".overlayPanel");
        if (p) focus.trapTabKey(e, p);
      }
    }
  });

  function renderTopbar(root) {
    const b = getActiveBoard();

    const boardSelect = el(
      "select",
      {
        class: "select",
        onChange: (e) => {
          activeBoardId = e.target.value || undefined;
          send({ type: "setActiveBoard", boardId: activeBoardId }, { trackBusy: false });
          render();
        },
      },
      [],
    );
    if (state) {
      const options = Object.values(state.boards)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((board) =>
          el("option", { value: board.id, text: board.name, selected: board.id === activeBoardId }),
        );
      for (const o of options) boardSelect.appendChild(o);
    }

    const renameBtn = el(
      "button",
      {
        class: "btn icon",
        title: ui.renamingBoard ? "Cancel rename" : "Rename board",
        onClick: () => {
          ui.renamingBoard = !ui.renamingBoard;
          ui.newBoard = false;
          render();
          const input = document.querySelector('input[data-role="renameBoardInput"]');
          if (input) input.focus();
        },
      },
      ["✎"],
    );

    const newBoardBtn = el(
      "button",
      {
        class: ui.newBoard ? "btn" : "btn primary",
        onClick: () => {
          ui.newBoard = !ui.newBoard;
          ui.renamingBoard = false;
          render();
          const input = document.querySelector('input[data-role="newBoardInput"]');
          if (input) input.focus();
        },
      },
      [ui.newBoard ? "Cancel" : "New board"],
    );

    const searchBox = el("div", { class: "search" }, [
      el("input", {
        id: "q",
        type: "text",
        placeholder: "Search cards…",
        value: ui.search.query,
        dataset: { focusId: "search-input" },
        onInput: (e) => {
          ui.search.query = e.target.value || "";
          debouncedSearch(ui.search.query);
        },
        onKeydown: (e) => {
          if (e.key === "Enter") {
            const q = (e.target.value || "").trim();
            if (!q) return;
            ui.search.query = q;
            ui.search.loading = true;
            openOverlay(
              "search",
              { query: q, results: [] },
              { openerFocusId: "search-input", takeFocus: true },
            );
            send({ type: "searchCards", query: q }, { trackBusy: false });
          }
          if (e.key === "Escape" && overlay.open && overlay.kind === "search") {
            e.preventDefault();
            closeOverlay();
          }
        },
      }),
      el(
        "button",
        {
          class: "btn",
          dataset: { focusId: "search-btn" },
          onClick: () => {
            const q = (byId("q").value || "").trim();
            if (!q) return;
            ui.search.query = q;
            ui.search.loading = true;
            openOverlay(
              "search",
              { query: q, results: [] },
              { openerFocusId: "search-btn", takeFocus: true },
            );
            send({ type: "searchCards", query: q }, { trackBusy: false });
          },
        },
        ["Search"],
      ),
    ]);

    const refreshBtn = el(
      "button",
      { class: "btn", onClick: () => send({ type: "refresh" }, { trackBusy: false }) },
      ["Refresh"],
    );

    const renameRow = (() => {
      if (!ui.renamingBoard || !b) return null;
      const input = el("input", {
        type: "text",
        value: b.name,
        dataset: { role: "renameBoardInput" },
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") {
          ui.renamingBoard = false;
          render();
        }
      });
      input.addEventListener("blur", () => {
        const name = (input.value || "").trim();
        ui.renamingBoard = false;
        if (name && name !== b.name) send({ type: "renameBoard", boardId: b.id, name });
        render();
      });
      return el("div", { class: "addRow", style: "width:min(520px, 55vw)" }, [input]);
    })();

    const newBoardRow = (() => {
      if (!ui.newBoard) return null;
      const input = el("input", {
        type: "text",
        placeholder: "Board name",
        dataset: { role: "newBoardInput" },
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const name = (input.value || "").trim();
          if (!name) return;
          ui.newBoard = false;
          send({ type: "createBoard", name });
          render();
        }
        if (e.key === "Escape") {
          ui.newBoard = false;
          render();
        }
      });
      return el("div", { class: "addRow", style: "width:min(520px, 55vw)" }, [input]);
    })();

    const busy = el("div", {
      class: "muted",
      dataset: { role: "busyIndicator" },
      "aria-hidden": "true",
      style: "white-space:nowrap",
    });

    const row = el("div", { class: "topbar" }, [
      boardSelect,
      renameBtn,
      newBoardBtn,
      renameRow || newBoardRow || el("div", { class: "spacer" }),
      !(renameRow || newBoardRow) ? searchBox : el("div", { class: "spacer" }),
      busy,
      refreshBtn,
    ]);
    root.appendChild(row);
    updateBusyIndicator();

    if (!state) return;
    const conflicts = state.conflicts || [];
    if (conflicts.length > 0) {
      root.appendChild(
        el("div", { class: "banner" }, [
          el("div", {}, [
            `${conflicts.length} conflicts detected. `,
            el(
              "a",
              {
                dataset: { focusId: "conflicts-link" },
                onClick: () => openOverlay("conflicts", {}, { openerFocusId: "conflicts-link" }),
              },
              ["View conflicts"],
            ),
            ". ",
            el("a", { onClick: () => send({ type: "refresh" }, { trackBusy: false }) }, [
              "Reload latest",
            ]),
            ".",
          ]),
        ]),
      );
    }

    if (!b) {
      root.appendChild(
        el("div", { class: "banner" }, [
          el("div", {}, [
            "No boards yet. ",
            el("a", { onClick: () => newBoardBtn.click() }, ["Create one"]),
            ".",
          ]),
        ]),
      );
    }
  }

  function renderBoard(root) {
    const board = getActiveBoard();
    const boardEl = el("div", { class: "board" });

    if (!state) {
      boardEl.appendChild(
        el("div", { class: "addList" }, [
          el("div", { class: "muted", text: "Repo not initialized or not accessible." }),
          el("div", { style: "height:10px" }),
          el("button", { class: "btn primary", onClick: () => send({ type: "initRepo" }) }, [
            "Initialize repo",
          ]),
          el("div", { style: "height:8px" }),
          el("button", { class: "btn", onClick: () => send({ type: "selectRepo" }) }, [
            "Select repo path",
          ]),
        ]),
      );
      root.appendChild(boardEl);
      return;
    }

    if (!board) {
      root.appendChild(boardEl);
      return;
    }

    const lists = orderedLists(board);

    for (const list of lists) {
      boardEl.appendChild(renderList(board, list, lists));
    }

    // Add list column
    const addList = el("div", { class: "addList" }, [
      el("div", { class: "muted", text: "Add a list" }),
      el("div", { style: "height:8px" }),
      el("div", { class: "addRow" }, [
        el("input", { type: "text", placeholder: "List title", dataset: { role: "addListTitle" } }),
        el(
          "button",
          {
            class: "btn primary",
            onClick: (e) => {
              const input = e.target
                .closest(".addList")
                .querySelector('input[data-role="addListTitle"]');
              const name = (input.value || "").trim();
              if (!name) return;
              input.value = "";
              send({ type: "createList", boardId: board.id, name });
            },
          },
          ["Add"],
        ),
      ]),
    ]);
    boardEl.appendChild(addList);

    root.appendChild(boardEl);
  }

  function renderList(board, list, ordered) {
    const headerTitle = el("h3", { text: list.name, dataset: { listId: list.id } });
    headerTitle.addEventListener("dblclick", () => {
      const input = el("input", { type: "text", value: list.name });
      const commit = () => {
        const name = (input.value || "").trim();
        input.replaceWith(headerTitle);
        headerTitle.textContent = name || list.name;
        if (name && name !== list.name) send({ type: "renameList", listId: list.id, name });
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") {
          input.replaceWith(headerTitle);
        }
      });
      input.addEventListener("blur", commit);
      headerTitle.replaceWith(input);
      input.focus();
      input.select();
    });

    const addCardInput = el("input", { type: "text", placeholder: "Add a card…" });
    const addCardBtn = el(
      "button",
      {
        class: "btn",
        onClick: () => {
          const title = (addCardInput.value || "").trim();
          if (!title) return;
          addCardInput.value = "";
          send({ type: "createCard", boardId: board.id, listId: list.id, title });
        },
      },
      ["Add"],
    );

    const listBody = el("div", {
      class: "listBody",
      dataset: { listId: list.id },
      onDragover: (e) => {
        if (e.dataTransfer && e.dataTransfer.types.includes("text/plain")) e.preventDefault();
      },
      onDrop: (e) => {
        const text = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
        if (!text) return;
        try {
          const data = JSON.parse(text);
          if (data.kind === "card") {
            // Drop to end of list
            send({ type: "moveCard", boardId: board.id, cardId: data.cardId, toListId: list.id });
          }
        } catch {}
      },
    });

    const cards = orderedCards(list);
    for (const card of cards) {
      listBody.appendChild(renderCard(board, list, card));
    }

    const listEl = el("div", { class: "list", dataset: { listId: list.id } }, [
      el(
        "div",
        {
          class: "listHeader",
          draggable: true,
          onDragstart: (e) => {
            e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "list", listId: list.id }));
            e.dataTransfer.effectAllowed = "move";
          },
          onDragover: (e) => {
            const dt = e.dataTransfer;
            if (!dt) return;
            if (dt.types.includes("text/plain")) e.preventDefault();
          },
          onDrop: (e) => {
            const text = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
            if (!text) return;
            try {
              const data = JSON.parse(text);
              if (data.kind !== "list") return;
              const fromId = data.listId;
              const targetId = list.id;
              if (fromId === targetId) return;

              const rect = e.currentTarget.getBoundingClientRect();
              const insertAfter = e.clientX > rect.left + rect.width / 2;
              if (insertAfter)
                send({
                  type: "moveList",
                  boardId: board.id,
                  listId: fromId,
                  afterListId: targetId,
                });
              else
                send({
                  type: "moveList",
                  boardId: board.id,
                  listId: fromId,
                  beforeListId: targetId,
                });
            } catch {}
          },
        },
        [headerTitle, el("span", { class: "muted", text: String(cards.length) })],
      ),
      listBody,
      el("div", { class: "listFooter" }, [
        el("div", { class: "addRow" }, [addCardInput, addCardBtn]),
      ]),
    ]);

    return listEl;
  }

  function renderCard(board, list, card) {
    const due = card.dueDate
      ? el("span", { class: "chip", text: `Due ${formatDate(card.dueDate)}` })
      : null;
    const labels =
      Array.isArray(card.labels) && card.labels.length > 0
        ? card.labels.slice(0, 3).map((l) => el("span", { class: "chip", text: l }))
        : [];
    const checklist = Array.isArray(card.checklist) ? card.checklist : [];
    const done = checklist.filter((it) => it.checked).length;
    const checklistChip =
      checklist.length > 0
        ? el("span", { class: "chip", text: `☑ ${done}/${checklist.length}` })
        : null;

    const meta = el("div", { class: "cardMeta" }, []);
    if (due) meta.appendChild(due);
    if (checklistChip) meta.appendChild(checklistChip);
    for (const c of labels) meta.appendChild(c);
    if (card.archived) meta.appendChild(el("span", { class: "chip", text: "archived" }));

    const cardEl = el(
      "div",
      {
        class: "card",
        role: "button",
        tabindex: "0",
        draggable: true,
        "aria-disabled": card.archived ? "true" : "false",
        dataset: { cardId: card.id, listId: list.id, focusId: `card:${card.id}` },
        onClick: () => openDrawer(card.id, `card:${card.id}`),
        onKeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDrawer(card.id, `card:${card.id}`);
          }
        },
        onDragstart: (e) => {
          e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "card", cardId: card.id }));
          e.dataTransfer.effectAllowed = "move";
        },
        onDragover: (e) => {
          const dt = e.dataTransfer;
          if (!dt) return;
          if (dt.types.includes("text/plain")) e.preventDefault();
        },
        onDrop: (e) => {
          const text = e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
          if (!text) return;
          try {
            const data = JSON.parse(text);
            if (data.kind !== "card") return;
            const fromCardId = data.cardId;
            const targetCardId = card.id;
            if (fromCardId === targetCardId) return;

            const rect = e.currentTarget.getBoundingClientRect();
            const insertAfter = e.clientY > rect.top + rect.height / 2;
            if (insertAfter)
              send({
                type: "moveCard",
                boardId: board.id,
                cardId: fromCardId,
                toListId: list.id,
                afterCardId: targetCardId,
              });
            else
              send({
                type: "moveCard",
                boardId: board.id,
                cardId: fromCardId,
                toListId: list.id,
                beforeCardId: targetCardId,
              });
          } catch {}
        },
      },
      [el("div", { class: "cardTitle", text: card.title }), meta],
    );
    return cardEl;
  }

  function renderDrawer(root) {
    const backdrop = el("div", {
      class: drawer.open ? "drawerBackdrop open" : "drawerBackdrop",
      onClick: (e) => {
        if (e.target === backdrop) closeDrawer();
      },
    });

    const card = drawer.open && state ? state.cards[drawer.cardId] : null;
    const comments = card && state ? state.commentsByCardId?.[card.id] || [] : [];
    const checklist = card && Array.isArray(card.checklist) ? card.checklist : [];
    const history = drawer.history || [];

    const titleInput = el("input", { type: "text", value: card ? card.title : "" });
    const descInput = el("textarea", {}, [card?.description || ""]);
    const dueInput = el("input", {
      type: "text",
      value: card?.dueDate || "",
      placeholder: "2026-01-01T00:00:00.000Z or empty",
    });
    const labelsInput = el("input", {
      type: "text",
      value: (card?.labels || []).join(", "),
      placeholder: "labels, comma-separated",
    });
    const archivedToggle = el("input", { type: "checkbox", checked: !!card?.archived });

    const saveBtn = el(
      "button",
      {
        class: "btn primary",
        onClick: () => {
          if (!card) return;
          const patch = {
            title: (titleInput.value || "").trim(),
            description: descInput.value || "",
            dueDate:
              (dueInput.value || "").trim().length === 0 ? null : (dueInput.value || "").trim(),
            labels: (labelsInput.value || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          };
          send({ type: "saveCard", cardId: card.id, patch, archived: !!archivedToggle.checked });
        },
      },
      ["Save"],
    );

    const openPanelBtn = el(
      "button",
      {
        class: "btn",
        onClick: () => card && send({ type: "openCard", cardId: card.id }, { trackBusy: false }),
      },
      ["Open in panel"],
    );

    const checklistAddInput = el("input", { type: "text", placeholder: "Add checklist item…" });
    const checklistAddBtn = el(
      "button",
      {
        class: "btn",
        onClick: () => {
          if (!card) return;
          const text = (checklistAddInput.value || "").trim();
          if (!text) return;
          checklistAddInput.value = "";
          send({ type: "addChecklistItem", cardId: card.id, text });
        },
      },
      ["Add"],
    );

    const commentInput = el("textarea", {}, []);
    commentInput.placeholder = "Write a comment…";
    commentInput.style.minHeight = "70px";
    const commentBtn = el(
      "button",
      {
        class: "btn primary",
        onClick: () => {
          if (!card) return;
          const text = (commentInput.value || "").trim();
          if (!text) return;
          commentInput.value = "";
          send({ type: "addComment", cardId: card.id, text });
        },
      },
      ["Add comment"],
    );

    const drawerTitleId = "drawerTitle";
    const drawerEl = el(
      "div",
      { class: "drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": drawerTitleId },
      [
        el("div", { class: "row" }, [
          el("div", { style: "flex:1" }, [
            el("h2", { id: drawerTitleId, text: card ? card.title : "Card" }),
            card
              ? el("div", {
                  class: "muted",
                  text: `cardId: ${card.id} • list: ${listName(card.listId)} • board: ${boardName(card.boardId)}`,
                })
              : el("div", { class: "muted", text: "No card selected" }),
          ]),
          el("button", { class: "btn", onClick: closeDrawer }, ["Close"]),
        ]),
        card
          ? el("div", {}, [
              el("div", { class: "field" }, [el("label", { text: "Title" }), titleInput]),
              el("div", { class: "field" }, [el("label", { text: "Description" }), descInput]),
              el("div", { class: "field" }, [
                el("label", { text: "Due date (ISO or empty)" }),
                dueInput,
              ]),
              el("div", { class: "field" }, [el("label", { text: "Labels" }), labelsInput]),
              el("div", { class: "field" }, [
                el("label", {}, [archivedToggle, document.createTextNode(" Archived")]),
              ]),
              el("div", { class: "row", style: "margin-top:12px" }, [saveBtn, openPanelBtn]),
              el("div", { class: "section" }, [
                el("h3", { text: "Checklist" }),
                el("div", { class: "addRow", style: "margin-bottom:10px" }, [
                  checklistAddInput,
                  checklistAddBtn,
                ]),
                ...checklist.map((it) =>
                  el("div", { class: "checklistItem" }, [
                    el("input", {
                      type: "checkbox",
                      checked: !!it.checked,
                      onChange: (e) =>
                        send({
                          type: "toggleChecklistItem",
                          cardId: card.id,
                          itemId: it.id,
                          checked: !!e.target.checked,
                        }),
                    }),
                    el("input", {
                      type: "text",
                      value: it.text,
                      onBlur: (e) => {
                        const text = (e.target.value || "").trim();
                        if (!text || text === it.text) return;
                        send({ type: "renameChecklistItem", cardId: card.id, itemId: it.id, text });
                      },
                    }),
                    el(
                      "button",
                      {
                        class: "btn",
                        onClick: () =>
                          send({ type: "removeChecklistItem", cardId: card.id, itemId: it.id }),
                      },
                      ["Remove"],
                    ),
                  ]),
                ),
              ]),
              el("div", { class: "section" }, [
                el("h3", { text: "Comments" }),
                el("div", { class: "field" }, [commentInput]),
                el("div", { class: "row", style: "margin-top:8px" }, [commentBtn]),
                el("div", { style: "height:10px" }),
                ...comments
                  .slice()
                  .sort((a, b) => a.ts.localeCompare(b.ts))
                  .map((c) =>
                    el("div", { class: "commentItem" }, [
                      el("div", { style: "flex:1" }, [
                        el("div", { class: "muted", text: `${formatDate(c.ts)} • ${c.actorId}` }),
                        el("pre", {}, [c.text]),
                      ]),
                    ]),
                  ),
              ]),
              el("div", { class: "section" }, [
                el("h3", { text: "History" }),
                ...(history.length === 0
                  ? [el("div", { class: "muted", text: "No history yet." })]
                  : history
                      .slice()
                      .sort((a, b) => a.seq - b.seq || a.opId.localeCompare(b.opId))
                      .map((h) =>
                        el("div", { class: "historyItem" }, [
                          el("div", {
                            class: "muted",
                            text: `${formatDate(h.ts)} • ${h.actorId} • ${h.type}`,
                          }),
                          el("div", { text: h.summary }),
                        ]),
                      )),
              ]),
            ])
          : el("div", { class: "muted", text: "Select a card to edit details." }),
      ],
    );

    backdrop.appendChild(drawerEl);
    root.appendChild(backdrop);
  }

  function renderOverlay(root) {
    const ov = el("div", {
      class: overlay.open ? "overlay open" : "overlay",
      onClick: (e) => {
        if (e.target === ov) closeOverlay();
      },
    });
    if (!overlay.open) {
      root.appendChild(ov);
      return;
    }

    if (overlay.kind === "search") {
      const query = overlay.payload?.query || "";
      const results = overlay.payload?.results || [];
      const panelTitleId = "searchOverlayTitle";
      const panel = el(
        "div",
        {
          class: "overlayPanel",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": panelTitleId,
        },
        [
          el("div", { class: "row" }, [
            el("div", { style: "flex:1" }, [
              el("h3", { id: panelTitleId, text: `Search: ${query}` }),
            ]),
            el("button", { class: "btn", onClick: closeOverlay }, ["Close"]),
          ]),
          ...(results.length === 0
            ? [
                el("div", {
                  class: "muted",
                  text: ui.search.loading ? "Searching…" : "No results.",
                }),
              ]
            : results.map((r) =>
                el(
                  "div",
                  {
                    class: "resultRow",
                    dataset: { focusId: `result:${r.cardId}` },
                    onClick: () => {
                      activeBoardId = r.boardId;
                      closeOverlay();
                      openDrawer(r.cardId, `result:${r.cardId}`);
                      send({ type: "setActiveBoard", boardId: r.boardId }, { trackBusy: false });
                    },
                  },
                  [
                    el("div", { text: r.title }),
                    el("div", {
                      class: "muted",
                      text: `${boardName(r.boardId)} • ${listName(r.listId)} • ${r.cardId}`,
                    }),
                  ],
                ),
              )),
        ],
      );
      ov.appendChild(panel);
      root.appendChild(ov);
      return;
    }

    if (overlay.kind === "conflicts") {
      const conflicts = state?.conflicts || [];
      const panelTitleId = "conflictsOverlayTitle";
      const panel = el(
        "div",
        {
          class: "overlayPanel",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": panelTitleId,
        },
        [
          el("div", { class: "row" }, [
            el("div", { style: "flex:1" }, [
              el("h3", { id: panelTitleId, text: `Conflicts (${conflicts.length})` }),
            ]),
            el("button", { class: "btn", onClick: closeOverlay }, ["Close"]),
          ]),
          ...(conflicts.length === 0
            ? [el("div", { class: "muted", text: "No conflicts." })]
            : conflicts.map((c) =>
                el("div", { class: "resultRow" }, [
                  el("div", { text: `${c.entityType}:${c.entityId}` }),
                  el("div", {
                    class: "muted",
                    text: `field=${c.field} seq=${c.seq} ops=${(c.ops || []).length}`,
                  }),
                ]),
              )),
          el("div", { style: "height:10px" }),
          el("div", {
            class: "muted",
            text: "Resolve conflicts by reconciling divergent ops in the repo; this UI is read-only for conflicts in v1.",
          }),
        ],
      );
      ov.appendChild(panel);
      root.appendChild(ov);
      return;
    }

    root.appendChild(ov);
  }

  function render() {
    const root = byId("app");
    root.innerHTML = "";
    renderTopbar(root);
    renderBoard(root);
    renderDrawer(root);
    renderOverlay(root);
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "opResult") {
      protocol.handleOpResult(msg);
      return;
    }
    if (msg.type === "state") {
      state = msg.state || null;
      if (msg.activeBoardId) activeBoardId = msg.activeBoardId;
      // keep drawer history if it matches card
      if (drawer.open && drawer.cardId) {
        // nothing
      }
      render();
      return;
    }
    if (msg.type === "toast") {
      toast(msg.level, msg.message);
      return;
    }
    if (msg.type === "searchResults") {
      if (overlay.open && overlay.kind === "search" && overlay.payload?.query === msg.query) {
        ui.search.loading = false;
        overlay.payload.results = msg.results || [];
        render();
      }
      return;
    }
    if (msg.type === "cardHistory") {
      if (drawer.open && drawer.cardId === msg.cardId) {
        drawer.history = msg.history || [];
        render();
      }
      return;
    }
  });

  post({ type: "ready" });
})();
