/**
 * Opens a sample of stored values with the key actually in use, and says so loudly when none of them opens.
 *
 * The assertion beside this one validates the *shape* of `KUMO_MASTER_KEY`. That is not the same as the key
 * being the one the data was written under. A rotated Key Vault value, or a database restored from a backup
 * taken before a rotation, produces a key that is perfectly well formed and opens nothing — and every
 * symptom then appears at the first reveal, which is the worst possible moment to discover it.
 *
 * Deliberately **not** a boot refusal. A data problem should not take ticketing down: an instance that reads
 * tickets correctly and cannot open the vault is more useful, and more diagnosable, than one that will not
 * start. The point is to have the log say what is wrong before a technician finds it.
 *
 * It goes to **console as well as the log file**, because `logger.warn` writes only to `dev-errors.log`
 * inside the container and Azure Container Apps forwards only stdout and stderr to Log Analytics. A warning
 * nobody can read is not a warning, and this is the one that matters most.
 *
 * Prisma is imported at the point of use, because index.ts imports this module and would otherwise still be
 * assembling its exports.
 */
import { decrypt, kumoKeyStatus } from "./kumoCrypto";
import { logger } from "./logger";

/** Enough rows that a wrong key is certain to show, few enough to be free at startup. */
const SAMPLE_SIZE = 20;

export async function warnIfKeyCannotOpenVault(): Promise<void> {
  try {
    const { prisma } = await import("../index");
    // Ordered, so the sample is the same set on every restart and two log lines are comparable. A vault
    // holding rows from two generations is exactly when the count is worth watching, and an unordered
    // sample would make the count wobble for no reason.
    const [rows, total] = await Promise.all([
      prisma.kumoPassword.findMany({
        select: { encryptedPassword: true, iv: true, authTag: true },
        orderBy: { id: "asc" },
        take: SAMPLE_SIZE,
      }),
      prisma.kumoPassword.count(),
    ]);

    // An empty vault agrees with any key, which is the state of a first deploy.
    if (rows.length === 0) return;

    let opened = 0;
    for (const row of rows) {
      try {
        decrypt(row.encryptedPassword, row.iv, row.authTag);
        opened++;
      } catch {
        // Counted by the total below; one unreadable row is not on its own a key problem.
      }
    }
    if (opened === rows.length) return;

    const { source, fingerprint } = kumoKeyStatus();
    const scope = rows.length < total ? `${rows.length} of ${total}` : `${rows.length}`;
    const message =
      `[KumoCrypto] the vault key from ${source} (fingerprint ${fingerprint}) opened ${opened} of ${scope} ` +
      `stored passwords. Reveals will fail for the rest. This is what a rotated key, or a database restored ` +
      `from before a rotation, looks like: the key is well formed but is not the one the data was written ` +
      `under. Run \`pnpm kumo:reencrypt\` — a dry run, it writes nothing — to see which generations the rows ` +
      `belong to before changing anything, and do not pass --apply until those counts make sense.`;

    logger.warn("startup", message);
    console.warn(message);
  } catch {
    // A check that cannot run must never affect startup.
  }
}