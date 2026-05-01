# Blackboard

Blackboard editor for a 3D action game portfolio.

The app runs in two modes:

- Local preview stores the board in `document/Blackboard.json`.
- GitHub Pages stores the board as `Blackboard.json` in the user's Google Drive.

## GitHub Pages

This repository includes a GitHub Actions workflow that publishes `public/` to GitHub Pages.

Expected URL after Pages is enabled:

```text
https://minohamikan.github.io/Blackboard/
```

## Google Drive Setup

Create a Google Cloud OAuth web client:

1. Enable the Google Drive API.
2. Create an OAuth Client ID with application type `Web application`.
3. Add authorized JavaScript origins:

```text
https://minohamikan.github.io
http://localhost:4173
```

4. Use this scope:

```text
https://www.googleapis.com/auth/drive.file
```

5. Put the client ID in `public/config.js`, or enter it in the app UI.

`drive.file` lets the app create and modify files it created, or files explicitly shared with the app. It does not grant broad access to all Drive files.

## Data

Local data files are intentionally ignored:

```text
document/Blackboard.md
document/Blackboard.json
document/Blackboard.html
```

To import existing data, open the app, connect Google, then use `Import JSON` and `Create Drive File`.

The optional top-level `currentItemId` field stores the item currently in progress. It should match an item `id`.

## Local Preview

```powershell
npm run serve
```

Open:

```text
http://localhost:4173
```

When opened from `localhost`, the app reads and saves this ignored local file:

```text
document/Blackboard.json
```

Use the app normally; edits are written back through the local preview server. Opening `public/index.html` directly from disk will not save to the JSON file.

## Migrate From Markdown

If you still have `document/Blackboard.md`, generate local JSON once:

```powershell
npm run blackboard:migrate
```
