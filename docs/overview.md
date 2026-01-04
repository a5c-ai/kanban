# Distributed trello kanban board clone

a minimal but beatiful and sleek kanban board clone with a backend and a frontend. distributed and decentralized at users' machines based on git.

## Features

- workspaces and boards within a workspace, lists within a board, and cards within a list
- invite users to workspaces and boards
- drag and drop cards between lists
- authentication (email/password, google, github)
- authorization (role-based access control)
- search
- comments
- attachments
- labels
- due dates
- checklists
- tags
- markdown support (editing, preview, rendering) - with mermaid support for diagrams
- code blocks support (editing, preview, rendering) with syntax highlighting

## Requirements

- git backend - meaning that the DB for the entire thing is maintained in a git repository (assuming that the git repository is the source of truth for the data and that it is cloned locally and preconfigured with the remote origin)
- real-time collaboration (websocket)
- TUI based client and a web client (responsive, nextjs, react native)
- no server-side backend besides for webhooks reactor - all logic is client-side through the sdk. the system is distributed and decentralized at users' machines.
- sdk-based, not API and backend (for wrapping the api for use in other projects)
- all clients should be able to use the sdk to interact with the distributed git backed backend
- webhooks reactor - pulls git changes and executes configurable webhooks (server side worker) - through the sdk
- configurable webhooks - for pushing events and changes in the project, based on the git repository - configuration within the git repository. - for example, when a card is moved to a different list. call https://your-server.com/api/v1/webhooks/card-moved with the card id and the new list id as payload.
