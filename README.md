# digicene.com

Source for [digicene.com](https://digicene.com), built with [Astro](https://astro.build) and deployed on DigitalOcean.

## Structure

```
src/
├── pages/            # site routes, API endpoints, and Chorus admin
├── components/       # interactive Chorus interface
├── content/          # Digicene essay
└── chorus/           # generation, scheduling, safety, and persistence
scripts/
└── chorus-worker.ts  # long-running AI Chorus worker
public/               # static images and video
test/                 # Chorus scheduler, budget, and selection tests
CHORUS.md             # Chorus architecture and operations
ASSETS.md             # visual asset source links
```

## Development

Requires Node.js 22.12 or newer.

```sh
cp .env.example .env
npm install
npm run dev       # localhost:4321
```

Run the Chorus worker separately with `npm run chorus:worker`. Mock mode is enabled by default and does not make paid model requests.

| Command                 | Action                              |
| ----------------------- | ----------------------------------- |
| `npm run dev`           | Start the local development server  |
| `npm run build`         | Build the production site to `dist` |
| `npm run preview`       | Preview the production build        |
| `npm test`              | Run the test suite                  |
| `npm run chorus:worker` | Start the Chorus worker             |
| `npm run chorus:once`   | Run one Chorus generation cycle     |

## Deployment

Pushes to `main` deploy to DigitalOcean through GitHub Actions. The Astro server and Chorus worker run as separate processes backed by a shared SQLite database. See [CHORUS.md](./CHORUS.md) for configuration, cost controls, and operations.
