# Manual verification

This file is part of the feature-coverage quality gate. Each feature below has steps that can be executed manually in VS Code.

## F-UI-Explorer

1. Open this repo in VS Code.
2. Open the Activity Bar "Kanban" view.
3. Confirm the "Explorer" tree loads and shows boards/lists/cards (after creating some).

## F-UI-CardWebview

1. In the Kanban Explorer tree, click a card.
2. Confirm a "Kanban Card" webview opens showing title/description/due date/labels.
3. Edit fields, click Save, then re-open the card and confirm changes persisted.

## F-UI-Conflicts

1. Create a repo with at least one conflict (or use an existing repo with conflicts).
2. Run `Kanban: Show Conflicts`.
3. Confirm conflicts are displayed in an output channel.

## F-UI-BoardView

1. Open this repo in VS Code.
2. Open the Activity Bar "Kanban" view and click "Board".
3. Create a board, list(s), and cards directly from the Board UI.
4. Confirm columns render with cards and the UI matches the current repo state after `Kanban: Refresh`.

## F-UI-DragDrop

1. In the Board view, drag a card within a list to reorder it.
2. Drag a card to another list.
3. Drag a list header left/right to reorder lists.
4. Confirm the ordering persists after refresh/reload.

## F-UI-CardDetails

1. Click a card in the Board view to open the details drawer.
2. Edit title/description/labels/due date and toggle archived, then click Save.
3. Add a checklist item, toggle it, rename it, and remove it.
4. Add a comment.
5. Confirm history entries appear for the actions you performed.

## F-UI-Search

1. In the Board view top bar, search for an existing card (by title or description tokens).
2. Confirm results appear and clicking a result opens the card details.

## F-UI-ConflictsInUI

1. Open a repo with at least one conflict.
2. Open the Board view and confirm a conflicts banner is shown and the conflict list is viewable.
3. Open any card in the Card webview panel and confirm a conflicts banner is visible there too.
