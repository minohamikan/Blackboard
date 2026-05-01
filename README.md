# Blackboard

Local-first blackboard editor for a 3D action game portfolio.

## Run Locally

```powershell
npm start
```

Open:

```text
http://localhost:4173
```

## Run With Docker

```powershell
docker compose up -d --build
```

`document/Blackboard.json` is local data and is intentionally not committed.

## Migrate From Markdown

If you have `document/Blackboard.md`, generate the JSON once:

```powershell
npm run blackboard:migrate
```
