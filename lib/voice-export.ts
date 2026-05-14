// safeString — escape an arbitrary string for embedding in a generated
// TypeScript source file as a string literal. JSON.stringify handles
// backslash, quote, CR/LF, and control chars; the double-quoted output
// keeps `${` and backticks inert. The post-pass escapes U+2028 (LINE
// SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR), which JSON.stringify
// does not escape under current V8 (those code points were
// retroactively legalized inside JS string literals in ES2019, and
// V8 dropped the escape behavior accordingly). Escaping them anyway
// keeps the generated file portable to lower ES targets and to
// editors that key on those bytes.
//
// The U+2028 / U+2029 / backslash characters are built via
// fromCharCode so this source file contains no invisible bytes;
// split/join avoids the new-RegExp-with-separator-char surprise
// where the constructor escapes the pattern in `.source`.
//
// Used by the voice-training export route to generate a
// committable lib/studio-voice.ts snapshot from an operator-curated
// voice_profiles row.
export function safeString(s: string): string {
  const BS = String.fromCharCode(0x5c);
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(s)
    .split(LS).join(BS + 'u2028')
    .split(PS).join(BS + 'u2029');
}
