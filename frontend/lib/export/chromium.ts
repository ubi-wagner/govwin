/**
 * Where Chromium is — one rule, for every part of the product that needs a browser.
 *
 * The PDF exporter needs it to render a document; the page-capture floor needs it to rasterize one.
 * Those two lived with separate answers for a while: the exporter searched four locations, and the
 * capture module read a `CHROMIUM_PATH` variable that nothing sets. In the sandbox that meant every
 * capture worked from a shell (where the variable had been exported by hand) and every capture
 * failed inside the running server — silently, because capture is best-effort by design. The
 * visible symptom was a Technical Volume that downloaded eleven pages against a ten-page cap: the
 * render-verified page fit had quietly measured nothing at all.
 *
 * Moving the rule here rather than importing it from the exporter also breaks the cycle that
 * created — page-capture importing pdf-exporter, which the export assembler imports alongside
 * page-capture, is exactly the shape that resolves to `undefined` at call time in a bundled build.
 */
let cached: string | undefined | null = null;

/**
 * Resolve the Chromium executable, in order of specificity. `undefined` means "let Playwright use
 * its own default", which is correct on a development machine with a full install.
 *
 * Memoized: the answer cannot change within a process, and every export would otherwise stat the
 * same paths again.
 */
export async function resolveChromiumExecutable(): Promise<string | undefined> {
  if (cached !== null) return cached ?? undefined;
  cached = await locate();
  return cached ?? undefined;
}

async function locate(): Promise<string | undefined> {
  const { existsSync } = await import('fs');

  // 1) Explicit override — production Docker points this at the apk-installed chromium.
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (explicit && existsSync(explicit)) return explicit;

  // 2) A Playwright-managed download under PLAYWRIGHT_BROWSERS_PATH (the sandbox layout).
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root) {
    try {
      const { readdirSync } = await import('fs');
      for (const d of readdirSync(root)) {
        if (d.startsWith('chromium-') && !d.includes('headless_shell')) {
          const p = `${root}/${d}/chrome-linux/chrome`;
          if (existsSync(p)) return p;
        }
      }
    } catch {
      /* fall through — an unreadable directory is not a reason to fail an export */
    }
  }

  // 3) A system Chromium. Robust to the exact package path so a mis-set variable cannot break
  //    PDF export on a host that plainly has a browser.
  for (const p of [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/lib/chromium/chromium',
  ]) {
    if (existsSync(p)) return p;
  }

  // 4) Playwright's own default.
  return undefined;
}
