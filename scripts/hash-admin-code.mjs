// Makes the scrambled (hashed) version of an admin access code for Netlify.
// The real code is never saved anywhere. Netlify only stores the hash.
//
// To change a code:
//   1. Get the current salt:   netlify env:get ADMIN_CODE_SALT
//   2. Hash the new code:      node scripts/hash-admin-code.mjs 1234567890 --salt <salt from step 1>
//   3. In Netlify: Project configuration > Environment variables, paste the result into
//      ADMIN_DEV_CODE_HASH (developer) or ADMIN_EDITOR_CODE_HASH (lead students / teacher).
//   4. Redeploy (Deploys > Trigger deploy) so the new code takes effect.
import { randomBytes } from 'node:crypto';
import { hashCode } from '../netlify/lib/admin-shared.mjs';

const [code, flag, saltArg] = process.argv.slice(2);
if (!/^\d{10}$/.test(code || '')) {
  console.error('Usage: node scripts/hash-admin-code.mjs <10-digit code> [--salt <salt>]');
  process.exit(1);
}
const salt = flag === '--salt' && saltArg ? saltArg : randomBytes(16).toString('hex');
if (flag !== '--salt') console.error(`New salt (set as ADMIN_CODE_SALT): ${salt}`);
console.log(hashCode(code, salt));
