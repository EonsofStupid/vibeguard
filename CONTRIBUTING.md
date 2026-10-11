# Local checks and CI

The Modelence application is in `web/`. The root `package.json` owns repository tools; it is not a second application. Use Node.js 22 or later, npm and Python 3.11 or later. CI uses Node 22 and Python 3.12.

From the repository root:

```powershell
npm ci
npm ci --prefix web
python -m pip install -e '.[dev,api,atlas]'
npm run hooks:install
```

Use a Python virtual environment for the Python install. On this existing Windows checkout, `.\.tools\python\python.exe` is an alternative to `python` if that is the configured interpreter. No `.env`, Atlas URI or model key is needed for these checks.

```powershell
npm run check
npm run test:python
npm run build
```

`check` runs Biome, Modelence TypeScript checking, the approved-context-policy tests and the owned-process launcher tests. The Python suite uses temporary stores, controlled model/provider doubles and a loopback HTTP server. CI installs the optional API dependency so those tests are not silently skipped. These checks do not establish deployed service readiness; live memory and chat evidence remain separate checkpoints in [SCOPE.md](SCOPE.md).

## Biome and hooks

Biome `2.5.15`, Lefthook `2.2.1` and the TypeScript test runner `tsx` `4.23.15` are pinned in the root lockfile. The starting lint baseline catches concrete correctness problems across `web/`, repository JavaScript tools and RRFlow agent source. Generated files, lockfiles and the unenabled mobile template are excluded. The earlier Next.js prototype is outside this initial Biome scope.

The initial gate deliberately does not enforce a repository-wide formatting migration. To format a file you are already editing:

```powershell
npm run format -- web/src/path/to/file.ts
```

Lefthook checks staged supported files before a commit and Modelence types before a push that changes web source/config. It does not rewrite or restage files. Its npm package normally installs hooks during dependency installation; `npm run hooks:install` also installs them explicitly and repairs a missing hook. Use `npm run hooks:check` to validate the configuration. Existing hooks should be reviewed before replacing them. CI disables local hook installation and runs the checks directly.

## GitHub Actions

The active workflow is [`.github/workflows/ci.yml`](.github/workflows/ci.yml) at the repository root. It runs on pushes to `main`/`dev`, pull requests and manual dispatch. Jobs have time limits, superseded runs are cancelled, and the workflow receives read-only repository permission. It uses SHA-pinned official GitHub actions and committed npm lockfiles. No deployment or cloud secrets are configured by this workflow.

The older `web/.github/workflows/ci.yml` is a nested template and is not the repository's active workflow. A green CI run means the checks passed; deploying to the existing Modelence app and verifying its live chat/review behavior remains a separate action.

Configuration follows the official [Biome reference](https://biomejs.dev/reference/configuration/) and [Lefthook npm setup](https://lefthook.dev/installation/node/).
