// KI-Verwaltung · Posteingang (v2.126.0): Verbindung zum bestehenden Postfach der Fahrschule.
// IMAP zum Abholen (imapflow), SMTP zum Senden (nodemailer), mailparser zum Zerlegen. Immer
// verschlüsselt (TLS direkt oder STARTTLS), mit knappen Zeitgrenzen - eine Netlify-Function hat
// nur Sekunden. Das Passwort kommt aus dem Supabase-Tresor und wird nirgends gespeichert oder geloggt.

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");

// Vorlagen der verbreiteten Anbieter (Server, Port, TLS direkt?). Alles andere: „Sonstiger Anbieter“.
const ANBIETER = {
  ionos: { name: "IONOS (1&1)", imap: ["imap.ionos.de", 993, true], smtp: ["smtp.ionos.de", 465, true] },
  strato: { name: "STRATO", imap: ["imap.strato.de", 993, true], smtp: ["smtp.strato.de", 465, true] },
  tonline: { name: "Telekom (T-Online)", imap: ["secureimap.t-online.de", 993, true], smtp: ["securesmtp.t-online.de", 465, true] },
  gmx: { name: "GMX", imap: ["imap.gmx.net", 993, true], smtp: ["mail.gmx.net", 465, true] },
  webde: { name: "WEB.DE", imap: ["imap.web.de", 993, true], smtp: ["smtp.web.de", 587, false] },
  gmail: { name: "Gmail (mit App-Passwort)", imap: ["imap.gmail.com", 993, true], smtp: ["smtp.gmail.com", 465, true] },
};

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{3,190}$/;
const IMAP_PORTS = [143, 993];
const SMTP_PORTS = [25, 465, 587, 2525];
// Server der Vorlagen sind bekannt und öffentlich - die brauchen keine Namensauflösung
const BEKANNT = new Set(Object.values(ANBIETER).flatMap(a => [a.imap[0], a.smtp[0]]));

// Nur öffentliche Ziele (Prüfung 21.10.2026): Über „Sonstiger Anbieter“ soll niemand mit einer eigenen
// Fahrschule interne Dienste abtasten können - auf Netlify nicht und erst recht nicht nach dem Umzug auf netcup.
function privateAdresse(ip) {
  const a = String(ip || "").toLowerCase();
  if (a.startsWith("::ffff:"))
    return privateAdresse(a.slice(7));
  if (a.includes(":"))
    return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  const t = a.split(".").map(Number);
  if (t.length !== 4 || t.some(x => !(x >= 0 && x <= 255)))
    return true;
  return t[0] === 0 || t[0] === 10 || t[0] === 127 || (t[0] === 169 && t[1] === 254) || (t[0] === 172 && t[1] >= 16 && t[1] <= 31)
    || (t[0] === 192 && t[1] === 168) || (t[0] === 100 && t[1] >= 64 && t[1] <= 127) || t[0] >= 224;
}
async function hostErlaubt(host, nachschlagen = (h) => require("dns").promises.lookup(h, { all: true, verbatim: true })) {
  if (BEKANNT.has(host))
    return true;
  let adressen;
  try { adressen = await nachschlagen(host); }
  catch (e) { return true; } // gibt es nicht: das meldet der Verbindungsversuch verständlich
  return Array.isArray(adressen) && adressen.length > 0 && !adressen.some(x => privateAdresse(x && x.address));
}
async function zielPruefen(host) {
  if (!(await hostErlaubt(host)))
    throw Object.assign(new Error("Der Server " + host + " ist nicht erlaubt."), { eigen: true });
}

// Eingaben der App prüfen und vereinheitlichen. Liefert { cfg } oder { fehler }.
function konfiguration(e) {
  const x = e || {};
  const t = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
  const vorlage = ANBIETER[x.anbieter] || null;
  const cfg = {
    email: t(x.email, 200).toLowerCase(),
    benutzer: t(x.benutzer, 200) || t(x.email, 200),
    imap_host: (vorlage ? vorlage.imap[0] : t(x.imap_host, 200)).toLowerCase(),
    imap_port: vorlage ? vorlage.imap[1] : Number(x.imap_port) || 993,
    imap_tls: vorlage ? vorlage.imap[2] : x.imap_tls !== false,
    smtp_host: (vorlage ? vorlage.smtp[0] : t(x.smtp_host, 200)).toLowerCase(),
    smtp_port: vorlage ? vorlage.smtp[1] : Number(x.smtp_port) || 465,
    smtp_tls: vorlage ? vorlage.smtp[2] : x.smtp_tls !== false,
    absender_name: t(x.absender_name, 120).replace(/[<>"\r\n]/g, ""),
  };
  if (!EMAIL.test(cfg.email))
    return { fehler: "Bitte eine gültige E-Mail-Adresse eingeben." };
  if (!HOST.test(cfg.imap_host) || !HOST.test(cfg.smtp_host))
    return { fehler: "Bitte die Server für Abholen (IMAP) und Senden (SMTP) eingeben, z. B. imap.ionos.de." };
  for (const p of [cfg.imap_port, cfg.smtp_port])
    if (!(Number.isInteger(p) && p > 0 && p < 65536))
      return { fehler: "Ungültiger Port." };
  // Gleiche Ziele wie lokale Netze ausschließen - die Function soll kein Werkzeug zum Abtasten werden
  if ([cfg.imap_host, cfg.smtp_host].some(h => /^(localhost|.*\.local|.*\.internal)$/.test(h)))
    return { fehler: "Dieser Server ist nicht erlaubt." };
  if ([cfg.imap_host, cfg.smtp_host].some(h => /^\d{1,3}(\.\d{1,3}){3}$/.test(h)))
    return { fehler: "Bitte den Namen des Servers eingeben (z. B. imap.ionos.de), keine IP-Adresse." };
  if (IMAP_PORTS.indexOf(cfg.imap_port) < 0 || SMTP_PORTS.indexOf(cfg.smtp_port) < 0)
    return { fehler: "Ungewöhnlicher Port. Üblich sind 993 oder 143 zum Abholen (IMAP) und 465, 587 oder 25 zum Senden (SMTP)." };
  return { cfg };
}

function imapClient(cfg, passwort) {
  return new ImapFlow({
    host: cfg.imap_host, port: cfg.imap_port, secure: !!cfg.imap_tls, doSTARTTLS: cfg.imap_tls ? undefined : true,
    auth: { user: cfg.benutzer, pass: passwort }, logger: false, emitLogs: false,
    connectionTimeout: 6000, greetingTimeout: 4000, socketTimeout: 8000, tls: { minVersion: "TLSv1.2" },
  });
}
function smtpTransport(cfg, passwort) {
  return nodemailer.createTransport({
    host: cfg.smtp_host, port: cfg.smtp_port, secure: !!cfg.smtp_tls, requireTLS: !cfg.smtp_tls,
    auth: { user: cfg.benutzer, pass: passwort }, connectionTimeout: 6000, greetingTimeout: 4000, socketTimeout: 8000,
    tls: { minVersion: "TLSv1.2" },
  });
}

// Fehler in verständliche Sätze für den Fahrlehrer übersetzen (ohne Technik, ohne Passwort)
function fehlerText(e, wo) {
  const t = String((e && (e.responseText || e.response || e.message)) || e || "");
  const code = String((e && (e.code || e.serverResponseCode)) || "");
  if (e && e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|authentication failed|535|534|Username and Password not accepted|LOGIN failed/i.test(t + code))
    return "Anmeldung abgelehnt. Prüfe E-Mail-Adresse und Passwort. Bei Gmail brauchst du ein App-Passwort, bei GMX und WEB.DE muss der Zugriff per IMAP in den Postfach-Einstellungen erlaubt sein.";
  if (/ENOTFOUND|EAI_AGAIN/.test(code + t))
    return "Den Server " + (wo || "") + " gibt es nicht. Bitte die Adresse prüfen.";
  if (/ETIMEDOUT|ESOCKET|ECONNREFUSED|timeout|Timed out/i.test(code + t))
    return "Der Server " + (wo || "") + " antwortet nicht. Bitte Server und Port prüfen.";
  if (/certificate|self.signed|CERT_/i.test(code + t))
    return "Die verschlüsselte Verbindung zum Server " + (wo || "") + " ließ sich nicht prüfen.";
  return "Die Verbindung zum Postfach ist fehlgeschlagen.";
}

// Verbindung testen: IMAP anmelden (Posteingang-Stand lesen) und SMTP prüfen
async function postfachPruefen(cfg, passwort) {
  await zielPruefen(cfg.imap_host);
  await zielPruefen(cfg.smtp_host);
  const c = imapClient(cfg, passwort);
  let stand;
  try {
    await c.connect();
    const s = await c.status("INBOX", { uidNext: true, uidValidity: true });
    stand = { uidNext: Number(s.uidNext) || 1, uidValidity: s.uidValidity != null ? Number(s.uidValidity) : null };
  }
  catch (e) {
    throw Object.assign(new Error(fehlerText(e, cfg.imap_host)), { eigen: true });
  }
  finally {
    try { await c.logout(); } catch (e) { }
  }
  try {
    await smtpTransport(cfg, passwort).verify();
  }
  catch (e) {
    throw Object.assign(new Error(fehlerText(e, cfg.smtp_host)), { eigen: true });
  }
  return stand;
}

// Neue Mails seit letzteUid holen (höchstens max, große Mails nur mit Kopfzeilen). Ändert sich die
// UIDVALIDITY (Postfach neu angelegt), beginnt die Zählung neu, ohne Altes nachzuholen.
async function neueMails(cfg, passwort, letzteUid, uidValidity, max) {
  await zielPruefen(cfg.imap_host);
  const c = imapClient(cfg, passwort);
  const mails = [];
  let neuerStand = { letzteUid: Number(letzteUid) || 0, uidValidity };
  try {
    await c.connect();
    const lock = await c.getMailboxLock("INBOX", { readOnly: true });
    try {
      const mb = c.mailbox || {};
      const uidNext = Number(mb.uidNext) || 1;
      const validity = mb.uidValidity != null ? Number(mb.uidValidity) : null;
      if (uidValidity != null && validity != null && Number(uidValidity) !== validity) {
        return { mails, letzteUid: uidNext - 1, uidValidity: validity, neuGestartet: true };
      }
      neuerStand = { letzteUid: Number(letzteUid) || 0, uidValidity: validity };
      if (uidNext - 1 <= neuerStand.letzteUid)
        return { mails, letzteUid: neuerStand.letzteUid, uidValidity: validity, neuGestartet: false };
      const kandidaten = [];
      // UID-Bereich "n:*" - liegt n über der höchsten UID, liefert IMAP die letzte Mail (deshalb der Filter)
      for await (const m of c.fetch((neuerStand.letzteUid + 1) + ":*", { uid: true, size: true }, { uid: true })) {
        if (Number(m.uid) > neuerStand.letzteUid)
          kandidaten.push({ uid: Number(m.uid), size: Number(m.size) || 0 });
      }
      kandidaten.sort((a, b) => a.uid - b.uid);
      for (const k of kandidaten.slice(0, max || 15)) {
        const voll = k.size <= 1500000;
        const m = await c.fetchOne(String(k.uid), voll ? { uid: true, source: true } : { uid: true, envelope: true, headers: true }, { uid: true });
        mails.push({ uid: k.uid, groesse: k.size, source: voll && m ? m.source : null, envelope: m && m.envelope, headers: m && m.headers });
        neuerStand.letzteUid = Math.max(neuerStand.letzteUid, k.uid);
      }
    }
    finally {
      lock.release();
    }
  }
  catch (e) {
    throw Object.assign(new Error(fehlerText(e, cfg.imap_host)), { eigen: true, anmeldung: !!(e && e.authenticationFailed) });
  }
  finally {
    try { await c.logout(); } catch (e) { }
  }
  return { mails, letzteUid: neuerStand.letzteUid, uidValidity: neuerStand.uidValidity, neuGestartet: false };
}

// Eine abgeholte Mail zerlegen: Absender, Betreff, Text, Kennungen für die Antwort, Kopfzeilen
async function mailZerlegen(m) {
  if (!m.source) {
    const env = m.envelope || {};
    const von = (env.from && env.from[0]) || {};
    return { von_name: String(von.name || ""), von_email: String(von.address || "").toLowerCase(), betreff: String(env.subject || ""),
      text: "(Die E-Mail ist zu groß, um sie hier zu zeigen – bitte im Postfach öffnen.)", message_id: String(env.messageId || ""),
      antwort_auf: String(env.inReplyTo || ""), referenzen: "", datum: env.date ? new Date(env.date).toISOString() : new Date().toISOString(), headers: {} };
  }
  const p = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
  const von = (p.from && p.from.value && p.from.value[0]) || {};
  const headers = {};
  if (p.headers && typeof p.headers.forEach === "function")
    p.headers.forEach((v, k) => { headers[String(k).toLowerCase()] = typeof v === "string" ? v : (v && (v.text || v.value)) || String(v || ""); });
  const roh = p.text || String(p.html || "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const refs = Array.isArray(p.references) ? p.references.join(" ") : String(p.references || "");
  return {
    von_name: String(von.name || "").slice(0, 200), von_email: String(von.address || "").toLowerCase().slice(0, 200), betreff: String(p.subject || "").slice(0, 300),
    text: roh, message_id: String(p.messageId || "").slice(0, 300), antwort_auf: String(p.inReplyTo || "").slice(0, 300), referenzen: refs.slice(0, 2000),
    datum: p.date ? new Date(p.date).toISOString() : new Date().toISOString(), headers, anhaenge: (p.attachments || []).length,
  };
}

// Anhänge einer schon abgeholten Mail (für Belege): die Mail per UID neu laden und zerlegen. Ist das
// Postfach inzwischen neu angelegt (UIDVALIDITY anders) oder die Mail nicht mehr im Posteingang, kommt null.
// Eingebettete Bilder (Logos, Signaturen) zählen nicht als Anhang.
async function mailAnhaenge(cfg, passwort, uid, uidValidity) {
  await zielPruefen(cfg.imap_host);
  const c = imapClient(cfg, passwort);
  try {
    await c.connect();
    const lock = await c.getMailboxLock("INBOX", { readOnly: true });
    try {
      const mb = c.mailbox || {};
      if (uidValidity != null && mb.uidValidity != null && Number(mb.uidValidity) !== Number(uidValidity))
        return null;
      const m = await c.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      if (!m || !m.source)
        return null;
      if (m.source.length > 15 * 1024 * 1024)
        throw Object.assign(new Error("Die E-Mail ist zu groß, um den Anhang zu holen."), { eigen: true });
      const p = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
      // Logos und Signatur-Bildchen (eingebettet oder winzig) sind keine Belege; eingefügte Fotos schon
      return (p.attachments || []).filter(a => a && a.content && !a.related
          && !(String(a.contentType || "").toLowerCase().indexOf("image/") === 0 && (Number(a.size) || a.content.length) < 15000))
        .map(a => ({ name: String(a.filename || "").slice(0, 120), typ: String(a.contentType || "").toLowerCase(), groesse: Number(a.size) || a.content.length, inhalt: a.content }));
    }
    finally {
      lock.release();
    }
  }
  catch (e) {
    if (e && e.eigen)
      throw e;
    throw Object.assign(new Error(fehlerText(e, cfg.imap_host)), { eigen: true });
  }
  finally {
    try { await c.logout(); } catch (e) { }
  }
}

// Antwort senden: nur an den ursprünglichen Absender, als Antwort im selben Verlauf, reiner Text.
// a.gesendet (optional): wird direkt nach dem erfolgreichen Senden abgewartet - dort vermerkt der
// Aufrufer den Versand, bevor die Kopie in den Ordner „Gesendet“ gelegt wird (bricht die Function
// danach ab, ist der Versand trotzdem eingetragen und nichts geht doppelt raus).
async function antwortSenden(cfg, passwort, a) {
  if (!EMAIL.test(String(a.an || "")))
    throw Object.assign(new Error("Keine gültige Empfänger-Adresse."), { eigen: true });
  await zielPruefen(cfg.smtp_host);
  const mail = {
    from: { name: cfg.absender_name || cfg.email, address: cfg.email },
    to: a.an, subject: String(a.betreff || "").replace(/[\r\n]+/g, " ").slice(0, 250), text: String(a.text || ""),
    inReplyTo: a.antwortAuf || undefined, references: [a.referenzen, a.antwortAuf].filter(Boolean).join(" ") || undefined,
    headers: { "Auto-Submitted": a.automatisch ? "auto-replied" : "no" },
  };
  let info;
  try {
    info = await smtpTransport(cfg, passwort).sendMail(mail);
  }
  catch (e) {
    throw Object.assign(new Error(fehlerText(e, cfg.smtp_host)), { eigen: true });
  }
  if (typeof a.gesendet === "function") {
    try { await a.gesendet(info); } catch (e) { /* die Mail ist raus - kein Fehler, sonst würde erneut gesendet */ }
  }
  if (a.ablegen !== false) {
    try {
      const roh = await new MailComposer({ ...mail, messageId: info && info.messageId }).compile().build();
      await zielPruefen(cfg.imap_host);
      const c = imapClient(cfg, passwort);
      await c.connect();
      try {
        const ordner = (await c.list()).find(f => f.specialUse === "\\Sent");
        if (ordner)
          await c.append(ordner.path, roh, ["\\Seen"]);
      }
      finally {
        try { await c.logout(); } catch (e) { }
      }
    }
    catch (e) { /* Kopie ist nur ein Komfort - die Mail ist raus */ }
  }
  return { messageId: (info && info.messageId) || "" };
}

// Neue Nachricht senden (Allindrive Autopilot: Zahlungserinnerung, Nachfassen). Reiner Text an genau eine
// Adresse, ohne Bezug auf eine frühere Mail (kein In-Reply-To, keine References), ohne HTML und Anhänge,
// von einem Menschen geschrieben (Auto-Submitted: no). Sonst wie antwortSenden: a.gesendet läuft direkt
// nach dem SMTP-Erfolg, danach kommt die Kopie in den Ordner „Gesendet“.
function nachrichtSenden(cfg, passwort, a) {
  return antwortSenden(cfg, passwort, { an: a.an, betreff: a.betreff, text: a.text, automatisch: false, gesendet: a.gesendet });
}

// Genau eine Empfänger-Adresse, wie antwortSenden sie annimmt. Komma und Semikolon liest nodemailer als
// Trenner mehrerer Empfänger - so eine Angabe gilt deshalb nicht als eine Adresse.
function emailGueltig(adresse) {
  const a = String(adresse == null ? "" : adresse);
  return EMAIL.test(a) && !/[,;]/.test(a);
}

module.exports = { ANBIETER, konfiguration, privateAdresse, hostErlaubt, fehlerText, postfachPruefen, neueMails, mailZerlegen, mailAnhaenge, antwortSenden, nachrichtSenden, emailGueltig };
