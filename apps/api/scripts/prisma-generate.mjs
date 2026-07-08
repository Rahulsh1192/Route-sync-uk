// Cross-platform `prisma generate` that works behind proxies which block
// binaries.prisma.sh. With engineType="client" (queryCompiler) there is no native
// query engine at runtime, but the Prisma CLI still runs an engine-download
// preflight on startup. Pointing these env vars at an existing file makes the CLI
// skip that download. See db/README or apps/api/README for context.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dummy = resolve(here, '..', 'prisma', 'schema.prisma'); // any existing file

const env = {
  ...process.env,
  PRISMA_QUERY_ENGINE_LIBRARY: dummy,
  PRISMA_SCHEMA_ENGINE_BINARY: dummy,
  PRISMA_FMT_BINARY: dummy,
};

execSync('npx prisma generate', { stdio: 'inherit', env });
