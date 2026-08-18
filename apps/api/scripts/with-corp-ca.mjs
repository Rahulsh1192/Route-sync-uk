// Run a command with the corporate root certificate trusted, if this machine has one.
//
// On a network that decrypts and re-signs HTTPS (Zscaler, Netskope, Cisco Secure Access),
// the certificate Node receives for api.resend.com — or any other third party — is signed
// by the company's own root. Windows trusts that root, so browsers are fine, but Node
// reads its own bundled roots and not the Windows store, so every outbound HTTPS call
// fails with UNABLE_TO_GET_ISSUER_CERT_LOCALLY. In the API that surfaces as signup
// succeeding while no verification email is ever sent, because MailService returns
// transport failures as values rather than throwing.
//
// NODE_EXTRA_CA_CERTS has to be set before Node starts, which is why this cannot live in
// .env — dotenv runs long after the TLS roots are loaded. Hence a wrapper.
//
// infra/local-ca/ is git-ignored and machine-specific (see docker-compose.corp-ca.yml,
// which does the same thing for the worker container), so its absence is the normal case:
// on an ordinary network this passes the command straight through unchanged. Nothing here
// disables verification — it adds one root to the set, it does not skip the check.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(here, '..', '..', '..', 'infra', 'local-ca', 'ca-bundle.pem');

// Re-quote arguments that contain whitespace: the shell below re-parses this string, and
// an argument that arrived as one token has to leave as one token.
const command = process.argv
  .slice(2)
  .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
  .join(' ');
if (!command) {
  console.error('usage: node scripts/with-corp-ca.mjs <command…>');
  process.exit(2);
}

const env = { ...process.env };
if (!env.NODE_EXTRA_CA_CERTS && existsSync(bundle)) {
  env.NODE_EXTRA_CA_CERTS = bundle;
  console.log(`[with-corp-ca] trusting corporate root from ${bundle}`);
}

// shell:true so the npm-installed `nest` / `node` on PATH resolves the same way it would
// from the npm script this replaces.
const { status } = spawnSync(command, { stdio: 'inherit', env, shell: true });
process.exit(status ?? 1);
