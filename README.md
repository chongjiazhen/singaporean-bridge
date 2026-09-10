# Singaporean Floating Bridge

Browser game of Singaporean floating bridge (bid, call a partner card, play 13 tricks) against three AI players. React + TypeScript + Vite + Tailwind.

Live: https://chongjiazhen.github.io/singaporean-bridge/

## Develop

```sh
npm ci
npm run dev        # local dev server
npx vitest run     # engine tests
```

## Deploy

GitHub Pages serves the `docs/` folder on `main`. There is no CI step: build, commit, push.

```sh
npm run build      # tsc + vite build -> docs/
git add docs
git commit -m "deploy: <what changed>"
git push
```
