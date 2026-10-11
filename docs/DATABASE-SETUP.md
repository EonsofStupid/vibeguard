# Database setup: one connection setting

Verified in the Atlas Connect dialog on 2026-10-11:
- Cluster: vibeguard (M10)
- Host: vibeguard.qyf6cd.mongodb.net
- Database user: clyffy
- Application database: vibeguard

Save the completed value under MONGODB_URI:

~~~text
mongodb+srv://clyffy:<DB_PASSWORD>@vibeguard.qyf6cd.mongodb.net/vibeguard?authSource=admin&retryWrites=true&w=majority&appName=vibeguard
~~~

Replace <DB_PASSWORD> with the URL-encoded password for the Atlas database user clyffy. This is not an Atlas account password, Agent Engine token, OpenAI key or Voyage key. The database name /vibeguard is included for Prisma; authSource=admin keeps database-user authentication explicit.

## Where to save it

1. Agent Engine project vibeguard: project secret named MONGODB_URI. The selected CLI context is hack. From the repo root, the CLI can prompt for its value:

~~~text
.\agentengine.exe secret set MONGODB_URI --project-scope --project-id 6acbc84c07e49c5b0f33c510
~~~

2. Local Next.js / Prisma app: set MONGODB_URI in vibeguard/.env.local. The field is prepared. db:generate and db:validate explicitly load that file.
3. Local Python workbench, when connecting it: set the same MONGODB_URI in the root .env; MONGODB_DATABASE is vibeguard.

The Prisma schema reads MONGODB_URI directly, so there is no second DATABASE_URL setting to maintain. Hosted secrets do not automatically populate local files.

## Prisma installation

Prisma is NOT installed as of this checkpoint. Agent environment access restrictions blocked the package-manager download from registry.npmjs.org with EACCES. The local configuration is prepared. From D:\localdev\vibeguard in a normal Windows terminal, run:

~~~text
tools\install-prisma.cmd
~~~

This installs pinned prisma@6.19.3 and @prisma/client@6.19.3, then generates the client. It stops on a command failure. MongoDB-compatible version selected from https://docs.prisma.io/docs/v7/prisma-orm/quickstart/mongodb .

The initial schema maps the existing facts document format from AtlasStore (_id string, record JSON, body string). No database push, migration, collection write or rule transition has been performed. Package installation and client generation do not prove a database connection. After saving the URI and completing installation, validate configuration, then perform a bounded database ping before configuring memory deployment.
