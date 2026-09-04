// Netlify Function: wird stuendlich vom pg_cron-Job "hourly-reminder-check" aufgerufen.
// Macht bei JEDEM Aufruf zwei Dinge:
// 1. Nur um 18 Uhr Europe/Berlin (No-op sonst, vermeidet die Sommer-/Winterzeit-Verschiebung
//    einer festen UTC-Cron-Zeit): fasst pro Fahrlehrer die morgigen bestaetigten Fahrstunden zu
//    einer Push zusammen - gleiche Ausschluss-Logik wie erinnerungsKandidaten() in index.html
//    (kein §SONST§/§URLAUB§-Termin, keine PRIVAT-Termine), nur serverseitig statt im Browser.
// 2. Nachhol-Lauf fuer verpasste Termin-Pushes (siehe catchUpMissedPushes) - faengt Faelle ab,
//    bei denen der direkte Postgres-Trigger aus irgendeinem Grund keine erfolgreiche Zustellung
//    hinbekommen hat (fehlendes Vault-Secret, Netzwerkausfall, tote Function).
// Die Reihenfolge ist bewusst so herum: frueher lief der Nachhol-Lauf zuerst und konnte bei einem
// groesseren Rueckstand das Zeitbudget der Function aufbrauchen, bevor die Tageserinnerungen
// ueberhaupt begonnen hatten - dann fiel die Abend-Erinnerung still ganz aus.

const { sendApnsPush } = require("./lib/apns");
const { notifyAppointmentEvent } = require("./lib/appointment-push");

const SUPABASE_URL = "https://oavuftlfnknucxuortar.supabase.co";
const SONST_MARK = "§SONST§";
const URLAUB_MARK = "§URLAUB§";
// Hoechstzahl nachgeholter Pushes pro Aufruf: ein Rueckstand (z.B. nach einer APNs-Stoerung) wird
// dadurch ueber mehrere stuendliche Laeufe abgebaut, statt einen einzigen Invoke ins Timeout zu
// treiben - jede Zeile kostet zwei Supabase-Requests plus eine eigene HTTP/2-Verbindung je Geraet.
const CATCHUP_LIMIT = 25;
// Ab so vielen Fahrlehrern wird die owner-Liste nicht mehr in die Query-URL geschrieben (sie wuerde
// zu lang), sondern nur noch in JS gefiltert.
const MAX_OWNER_FILTER = 200;

function berlinDateStr(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(date);
}
function berlinHour(date) {
  const parts = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour");
  return h ? parseInt(h.value, 10) : null;
}

// Bisher war "berlinHour(now) === 18" der EINZIGE Schutz gegen doppelten Versand - ein zweiter
// Aufruf innerhalb derselben Stunde (manueller Re-Invoke, Netlify-Retry nach Timeout, ein
// versehentlicher Doppelschuss aus pg_cron) haette allen Fahrlehrern dieselbe Push nochmal
// geschickt. app_settings (id=1) ist die vorhandene App-weite Einstellungs-Singleton-Zeile; der
// PATCH hier ist bewusst BEDINGT (nur wenn das Datum noch nicht auf heute steht) und liefert per
// return=representation nur dann eine Zeile zurueck, wenn er wirklich etwas geaendert hat - damit
// ist "pruefen" und "beanspruchen" EIN atomarer DB-Aufruf statt zweier getrennter Schritte, die
// sich bei einem echten Doppelaufruf ueberholen koennten.
async function claimDailyReminderSlot(sbFetch, todayStr) {
  const resp = await sbFetch(
    "app_settings?id=eq.1&or=(last_daily_reminder_sent.is.null,last_daily_reminder_sent.neq." + todayStr + ")",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ last_daily_reminder_sent: todayStr }),
    }
  );
  if (!resp.ok) return false; // im Zweifel NICHT senden - lieber eine ausgelassene als eine doppelte Runde
  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

// Alle Fahrlehrer mit mindestens einem registrierten Geraet - beide Bloecke unten brauchen dieselbe
// Liste, deshalb genau einmal laden.
async function loadDeviceOwners(sbFetch) {
  const resp = await sbFetch("device_tokens?select=owner");
  if (!resp.ok) throw new Error("Geraeteliste konnte nicht geladen werden (" + resp.status + ")");
  const rows = (await resp.json()) || [];
  return [...new Set(rows.map((r) => r.owner).filter(Boolean))];
}

// Der Trigger notify_appointment_push() merkt sich in push_pending_since nur den ZEITPUNKT, nicht
// die Art des Ereignisses - die muesste eigentlich aus dem heutigen Zustand der Zeile abgeleitet
// werden. Ein erster Versuch hat genau das fuer 'confirmed' per Heuristik getan (Titel leer +
// student_id gesetzt + offered_at leer = "Warteliste-Angebot uebernommen"), aber diese Signatur ist
// NICHT eindeutig: eine vom Fahrlehrer selbst angelegte Fahrstunde hat ebenfalls title:"" (openNewAppt
// setzt das so - der Titel ist nur fuer Termine ohne Schueler gedacht), und lehnt der Fahrlehrer eine
// Storno-Anfrage dafuer ab (rejectCancel setzt status wieder auf 'confirmed'), entsteht exakt dieselbe
// Zeilenform wie beim echten Angebots-Uebernehmen. Die Function haette dann eine sachlich falsche Push
// ("Freie Stunde vergeben - <Name> hat die freie Stunde uebernommen") fuer eine Stunde verschickt, die
// nie frei war. Deshalb bewusst NICHT geraten: fuer 'confirmed' wird der Merker nur noch stillschweigend
// geraeumt (er blieb vorher fuer immer stehen, siehe Kommentar bei catchUpMissedPushes), aber nie mehr
// eine Push daraus abgeleitet. Eine ausgelassene Nachhol-Push ist harmlos, eine falsche nicht. Eine
// echte Nachholung dieses Falls braucht den tatsaechlichen Ereignistyp aus der Datenbank (z.B. eine
// eigene Spalte appointments.push_pending_event, die notify_appointment_push() neben
// push_pending_since mitschreibt), nicht ein Raten aus dem Endzustand der Zeile.
function pendingEventOf(row) {
  if (row.status === "pending") return "new_request";
  if (row.status === "cancel_requested") return "cancel_requested";
  return null;
}

async function clearPushPending(sbFetch, appointmentId) {
  await sbFetch("appointments?id=eq." + encodeURIComponent(appointmentId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ push_pending_since: null }),
  }).catch(() => {});
}

// Termine mit offener Push-Zustellung (push_pending_since gesetzt), die vor mindestens 10 Min.
// (Anlaufzeit fuer den normalen Trigger-Pfad) und hoechstens 24h passiert sind - alles Aeltere
// ist vermutlich laengst anderweitig bemerkt worden und wuerde nur unnoetig nachtraeglich stoeren.
async function catchUpMissedPushes(sbFetch, serviceKey, deviceOwners) {
  // Fahrlehrer ohne registriertes Geraet aussortieren: an sie ist nichts zustellbar, ihre Termine
  // wuerden aber 24h lang stuendlich erneut versucht und dabei das Limit unten belegen, sodass
  // neuere, zustellbare Termine nie an die Reihe kaemen. Der Merker bleibt bei ihnen bewusst
  // stehen - registrieren sie innerhalb der 24h ein Geraet, wird die Push doch noch nachgeholt.
  if (deviceOwners && !deviceOwners.length) return { checked: 0, recovered: 0, cleared: 0 };
  const ownerSet = deviceOwners ? new Set(deviceOwners) : null;
  const ownerFilter =
    deviceOwners && deviceOwners.length && deviceOwners.length <= MAX_OWNER_FILTER
      ? "&owner=in.(" + deviceOwners.map(encodeURIComponent).join(",") + ")"
      : "";

  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const notTooOld = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const resp = await sbFetch(
    "appointments?push_pending_since=not.is.null" +
      "&push_pending_since=lte." + encodeURIComponent(cutoff) +
      "&push_pending_since=gte." + encodeURIComponent(notTooOld) +
      "&status=in.(pending,cancel_requested,confirmed)" + ownerFilter +
      "&select=id,owner,status,title,student_id,offered_at" +
      "&order=push_pending_since.asc&limit=" + CATCHUP_LIMIT
  );
  if (!resp.ok) return { checked: 0, recovered: 0, cleared: 0 };
  const rows = ((await resp.json()) || []).filter((r) => !ownerSet || ownerSet.has(r.owner));
  let recovered = 0;
  let cleared = 0;
  for (const row of rows) {
    const evt = pendingEventOf(row);
    try {
      if (!evt) {
        // Nichts mehr zuzustellen (der Fahrlehrer hat den Vorgang selbst in der App erledigt) -
        // Merker raeumen, sonst blockiert die Zeile bis zu 24h lang einen der Plaetze oben.
        await clearPushPending(sbFetch, row.id);
        cleared++;
        continue;
      }
      const result = await notifyAppointmentEvent({ evt, appointmentId: row.id, owner: row.owner, serviceKey });
      if (result && result.sent > 0) recovered++;
    } catch (e) {
      // naechster Versuch beim naechsten stuendlichen Aufruf
    }
  }
  return { checked: rows.length, recovered, cleared };
}

// Die eigentliche 18-Uhr-Runde: pro Fahrlehrer eine Sammel-Push fuer die morgigen Fahrstunden.
async function sendDailyReminders(sbFetch, now, owners) {
  if (!owners.length) return { owners: 0 };

  const tomorrowStr = berlinDateStr(new Date(now.getTime() + 24 * 3600 * 1000));
  // Grosszuegiges UTC-Fenster (heute bis +3 Tage), exakter Tagesvergleich passiert unten in JS
  // per Berliner Kalenderdatum - vermeidet fehleranfaellige DST-Randfaelle in der URL selbst.
  const fromStr = now.toISOString();
  const toStr = new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString();

  const results = [];
  for (const owner of owners) {
    const apptResp = await sbFetch(
      "appointments?owner=eq." + owner + "&status=eq.confirmed" +
        "&start_at=gte." + encodeURIComponent(fromStr) +
        "&start_at=lte." + encodeURIComponent(toStr) +
        "&select=start_at,note,art,student_id&order=start_at.asc"
    );
    if (!apptResp.ok) continue;
    const rows = (await apptResp.json()) || [];
    const relevant = rows.filter((a) => {
      const note = a.note || "";
      if (note.indexOf(SONST_MARK) === 0 || note.indexOf(URLAUB_MARK) === 0) return false;
      if (a.art === "PRIVAT") return false;
      if (!a.student_id) return false;
      return berlinDateStr(new Date(a.start_at)) === tomorrowStr;
    });
    if (!relevant.length) continue;

    const firstTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(
      new Date(relevant[0].start_at)
    );
    const count = relevant.length;
    const title = "Morgen: " + count + (count === 1 ? " Fahrstunde" : " Fahrstunden");
    const body = count === 1 ? "1 Fahrstunde morgen, um " + firstTime + " Uhr." : count + " Fahrstunden morgen, erste um " + firstTime + " Uhr.";

    try {
      const sendResult = await sendApnsPush({ ownerId: owner, title, body, data: { type: "daily_reminder" } });
      results.push({ owner, count, sent: sendResult.sent });
    } catch (e) {
      // Frueher riss ein einzelner Fehler (z.B. 503 beim Laden der Geraetetoken) die ganze Schleife
      // ab, sodass alle danach folgenden Fahrlehrer ihre Abend-Erinnerung nie bekamen.
      console.error("Tageserinnerung fehlgeschlagen fuer " + owner + ":", e);
      results.push({ owner, count, error: e.message || "Versand fehlgeschlagen" });
    }
  }

  return { processed: results.length, results };
}

exports.handler = async function (event) {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };
  }

  const secret = process.env.CRON_SECRET;
  if (!secret || event.headers["x-cron-secret"] !== secret) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: "Nicht autorisiert" }) };
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Kein Service-Role-Key hinterlegt." }) };
  }
  // APNs-Zugangsdaten genauso frueh pruefen wie den Service-Role-Key: fehlen sie, wirft erst
  // sendApnsPush mitten in der Schleife - der Lauf haette dann schon die halbe Arbeit gemacht,
  // ohne dass ein einziger Fahrlehrer erreicht wurde.
  if (!process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID || !process.env.APNS_PRIVATE_KEY) {
    console.error("APNs-Umgebungsvariablen unvollstaendig (APNS_KEY_ID/APNS_TEAM_ID/APNS_PRIVATE_KEY).");
    return { statusCode: 500, headers, body: JSON.stringify({ error: "APNs-Zugangsdaten fehlen." }) };
  }
  const sbFetch = (path, init) =>
    fetch(SUPABASE_URL + "/rest/v1/" + path, {
      ...(init || {}),
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        ...((init && init.headers) || {}),
      },
    });

  let deviceOwners = null; // null = Liste nicht ladbar, dann laeuft der Nachhol-Lauf ungefiltert
  try {
    deviceOwners = await loadDeviceOwners(sbFetch);
  } catch (e) {
    console.error("Geraeteliste konnte nicht geladen werden:", e);
  }

  const now = new Date();
  let daily = { skipped: "not_18_berlin" };
  let dailyError = null;
  if (berlinHour(now) === 18) {
    try {
      if (!deviceOwners) throw new Error("Geraeteliste konnte nicht geladen werden");
      // Den Tages-Slot erst JETZT beanspruchen, nachdem alle Vorbedingungen (Geraeteliste geladen)
      // erfuellt sind - sonst wuerde ein fruehzeitiger Abbruch (z.B. Geraeteliste nicht ladbar) den
      // Slot fuer heute schon verbrauchen, ohne dass je eine Push verschickt wurde, und der naechste
      // Aufruf innerhalb derselben Stunde koennte es nicht mehr nachholen.
      const geclaimt = await claimDailyReminderSlot(sbFetch, berlinDateStr(now));
      if (!geclaimt) {
        // Entweder lief die 18-Uhr-Runde fuer heute bereits (Normalfall bei einem zweiten Aufruf
        // in derselben Stunde), oder der Claim-Request selbst ist fehlgeschlagen - beides bewusst
        // KEIN Fehler, sondern ein sauberer No-op.
        daily = { skipped: "already_sent_today" };
      } else {
        daily = await sendDailyReminders(sbFetch, now, deviceOwners);
      }
    } catch (e) {
      console.error("18-Uhr-Runde fehlgeschlagen:", e);
      dailyError = e.message || "Serverfehler";
    }
  }

  let catchUp;
  try {
    catchUp = await catchUpMissedPushes(sbFetch, serviceKey, deviceOwners);
  } catch (e) {
    console.error("Nachhol-Lauf fehlgeschlagen:", e);
    catchUp = { error: e.message || "Nachhol-Lauf fehlgeschlagen" };
  }

  if (dailyError) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: dailyError, catchUp }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify({ ...daily, catchUp }) };
};
