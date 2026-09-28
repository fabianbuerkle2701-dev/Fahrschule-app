// Prüfskript für index.html: Modul-Syntax, NUL-Bytes, @media print unverändert ggü. HEAD, keine Hooks nach frühem Return in App().
const fs = require("fs"), cp = require("child_process"), path = require("path");
const datei = process.argv[2] || "index.html";
const h = fs.readFileSync(datei, "utf8");
let ok = true;
const m = h.match(/<script type="module">([\s\S]*?)<\/script>/);
const tmp = path.join(require("os").tmpdir(), "allindrive-mod-check.mjs");
fs.writeFileSync(tmp, m[1]);
try { cp.execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" }); console.log("Syntax Modul: ok"); }
catch (e) { ok = false; console.log("SYNTAXFEHLER:\n" + String(e.stderr).slice(0, 1500)); }
const nul = (h.match(/\u0000/g) || []).length; console.log("NUL-Bytes: " + nul); if (nul) ok = false;
const druck = t => { const teile = []; let i = 0;
    while ((i = t.indexOf("@media print", i)) >= 0) { const a = t.indexOf("{", i); let tiefe = 0, j = a;
        for (; j < t.length; j++) { if (t[j] === "{") tiefe++; else if (t[j] === "}" && --tiefe === 0) break; }
        teile.push(t.slice(i, j + 1)); i = j + 1; }
    return teile; };
let alt = "";
try { alt = cp.execSync("git show HEAD:" + path.basename(datei), { cwd: path.dirname(path.resolve(datei)), maxBuffer: 1 << 28 }).toString(); } catch (e) { }
const dn = druck(h); console.log("Druckblöcke: " + dn.length + " (" + dn.map(x => x.length).join("/") + " Zeichen)");
const gleich = !alt || JSON.stringify(druck(alt)) === JSON.stringify(dn); console.log("Druckbereich unverändert: " + gleich); if (!gleich) ok = false;
const z = h.split("\n");
const appStart = z.findIndex(l => /^function App\(\)/.test(l));
let frueh = -1;
for (let i = appStart + 1; i < z.length; i++) {
    if (/^}/.test(z[i])) break;
    if (/^    if \(.*\)\s*$/.test(z[i]) && /^        return /.test(z[i + 1] || "")) { frueh = i; break; }
    if (/^    if \(.*\)\s*return /.test(z[i])) { frueh = i; break; }
}
const hooks = [];
for (let i = frueh; frueh > 0 && i < z.length; i++) {
    if (/^}/.test(z[i])) break;
    if (/^    (const|let) .*=\s*(React\.)?use(State|Ref|Effect|Memo|Callback|Reducer|LayoutEffect)\(/.test(z[i]) || /^    (React\.)?use(Effect|LayoutEffect)\(/.test(z[i])) hooks.push(i + 1);
}
console.log("Hooks nach frühem Return (Zeilen): " + (hooks.length ? hooks.join(", ") : "keine")); if (hooks.length) ok = false;
console.log(ok ? "ALLES OK" : "FEHLER");
process.exit(ok ? 0 : 1);
