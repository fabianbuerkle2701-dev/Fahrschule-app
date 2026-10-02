import WidgetKit
import SwiftUI

// Kalender-Widget der Lehrer-App (Okt 2026, ersetzt den einfachen Tagesplan).
//
// Eigener Prozess, keine eigene Supabase-Session - deshalb der Token-Umweg: die Haupt-App legt
// einen Widget-Token per App-Group-UserDefaults ab (MainViewController.swift, "nativeWidgetToken";
// gesendet von ensureWidgetToken() in index.html), das Widget ruft damit die RPC widget_kalender auf.
// Die letzte erfolgreiche Antwort wird zwischengespeichert, damit das Widget ohne Netz nicht leer ist.
// kind bleibt "TodayWidget", damit schon platzierte Widgets nach dem Update weiterlaufen.

private let supabaseURL = "https://oavuftlfnknucxuortar.supabase.co"
private let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8"
private let appGroupId = "group.com.allindrive.lehrer"
private let cacheKey = "widgetKalenderCache"
private let berlin = TimeZone(identifier: "Europe/Berlin") ?? .current
private let markenOrange = Color(red: 1.0, green: 147.0 / 255.0, blue: 0.0)

// MARK: - Daten

struct KalenderAntwort: Codable {
    let anfragen: Int?
    let termine: [Termin]
}

struct Termin: Codable, Identifiable, Hashable {
    let id: String
    let start_at: String
    let end_at: String?
    let art: String?
    let typ: String?
    let titel: String?
    let ort: String?
    let storno: Bool?

    var start: Date { Datum.parse(start_at) ?? .distantPast }
    var ende: Date { end_at.flatMap(Datum.parse) ?? start.addingTimeInterval(45 * 60) }
    var istUrlaub: Bool { typ == "urlaub" }
    var istPrivat: Bool { typ == "privat" }
    var name: String { titel ?? "Termin" }
    var farbe: Color { istPrivat ? Color(.systemGray) : istUrlaub ? Color(red: 0.85, green: 0.6, blue: 0.1) : ArtFarbe.von(art) }
    var artKurz: String? {
        guard let a = art, !a.isEmpty, a != "PRIVAT", !istUrlaub else { return nil }
        return a
    }
}

enum Datum {
    private static let mitBruch: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let ohneBruch: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()
    static func parse(_ s: String) -> Date? { mitBruch.date(from: s) ?? ohneBruch.date(from: s) }

    static var kalender: Calendar {
        var c = Calendar(identifier: .gregorian); c.timeZone = berlin; c.locale = Locale(identifier: "de_DE"); return c
    }
    static func uhr(_ d: Date) -> String { format(d, "HH:mm") }
    static func format(_ d: Date, _ muster: String) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "de_DE"); f.timeZone = berlin; f.dateFormat = muster
        return f.string(from: d)
    }
    // "Heute", "Morgen", sonst "Mo., 5.10."
    static func tagLabel(_ d: Date, jetzt: Date) -> String {
        let k = kalender
        if k.isDate(d, inSameDayAs: jetzt) { return "Heute" }
        if let morgen = k.date(byAdding: .day, value: 1, to: jetzt), k.isDate(d, inSameDayAs: morgen) { return "Morgen" }
        return format(d, "EE, d.M.")
    }
}

// Gleiche Farben wie APPT_ART in index.html
enum ArtFarbe {
    private static let hex: [String: UInt32] = [
        "ÜST": 0xFF9300, "AB": 0x4A5FE1, "ÜL": 0x689F38, "NF": 0x5E35B1, "GF": 0x00897B, "UW": 0x8D6E63,
        "AKH": 0x00ACC1, "VS": 0xD81B60, "VT": 0xAB47BC, "PF": 0xD32F2F, "SF": 0xBF7B16, "ST": 0x78909C,
        "STI": 0x546E7A, "T1": 0xE53935, "T2": 0xC62828, "T3": 0xB71C1C, "B197": 0x9E9D24, "FPASF": 0xE64A19,
        "SASF": 0x7B1FA2, "TH": 0x2B7FFF, "SIM": 0x6D5DD3, "PRIVAT": 0x8B95A6,
    ]
    static func von(_ art: String?) -> Color {
        guard let a = art, let h = hex[a] else { return markenOrange }
        return Color(red: Double((h >> 16) & 0xFF) / 255, green: Double((h >> 8) & 0xFF) / 255, blue: Double(h & 0xFF) / 255)
    }
}

// MARK: - Timeline

struct KalenderEntry: TimelineEntry {
    let date: Date
    let termine: [Termin]
    let anfragen: Int
    let angemeldet: Bool

    // Termine, die noch nicht vorbei sind (Urlaub zählt als ganztägig und steht nicht als "nächster")
    var kommende: [Termin] { termine.filter { $0.ende > date } }
    var heute: [Termin] { termine.filter { Datum.kalender.isDate($0.start, inSameDayAs: date) } }
    var heuteKommend: [Termin] { heute.filter { $0.ende > date && !$0.istUrlaub } }
    var naechster: Termin? { kommende.first { !$0.istUrlaub } }
    var urlaubHeute: Bool { heute.contains { $0.istUrlaub } }
}

enum Abruf: Error { case tokenUngueltig }

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> KalenderEntry { Beispiel.entry() }

    func getSnapshot(in context: Context, completion: @escaping (KalenderEntry) -> Void) {
        if context.isPreview { completion(Beispiel.entry()); return }
        Task { completion(await laden(jetzt: Date()).first ?? Beispiel.entry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<KalenderEntry>) -> Void) {
        Task {
            let jetzt = Date()
            let entries = await laden(jetzt: jetzt)
            // Spätestens nach 30 Minuten (und kurz nach Mitternacht) neu laden; die App stößt nach
            // Änderungen zusätzlich selbst einen Reload an (WidgetCenter.reloadAllTimelines()).
            var naechsterAbruf = jetzt.addingTimeInterval(30 * 60)
            if let mitternacht = Datum.kalender.nextDate(after: jetzt, matching: DateComponents(hour: 0, minute: 1), matchingPolicy: .nextTime),
               mitternacht < naechsterAbruf { naechsterAbruf = mitternacht }
            completion(Timeline(entries: entries, policy: .after(naechsterAbruf)))
        }
    }

    // Ein Eintrag jetzt und je einer zum Ende jedes heutigen Termins - so rückt "Nächster Termin"
    // auch ohne Netzabruf pünktlich weiter.
    private func laden(jetzt: Date) async -> [KalenderEntry] {
        let defaults = UserDefaults(suiteName: appGroupId)
        // Leerer Token = abgemeldet (die App schickt beim Abmelden "" über nativeWidgetToken)
        guard let token = defaults?.string(forKey: "widgetToken"), !token.isEmpty else {
            defaults?.removeObject(forKey: cacheKey)
            return [KalenderEntry(date: jetzt, termine: [], anfragen: 0, angemeldet: false)]
        }
        var antwort: KalenderAntwort?
        do {
            if let frisch = try await abrufen(token: token) {
                antwort = frisch
                if let daten = try? JSONEncoder().encode(frisch) {
                    defaults?.set(daten, forKey: cacheKey)
                    defaults?.set(token, forKey: cacheKey + "Token")
                }
            }
        } catch Abruf.tokenUngueltig {
            // Server kennt den Token nicht (mehr): nicht "frei" anzeigen, sondern zur Anmeldung auffordern
            defaults?.removeObject(forKey: cacheKey)
            return [KalenderEntry(date: jetzt, termine: [], anfragen: 0, angemeldet: false)]
        } catch {
            // Netzfehler: letzter Stand, aber nur, wenn er zu diesem Token gehört (kein fremder Kalender)
            if defaults?.string(forKey: cacheKey + "Token") == token, let daten = defaults?.data(forKey: cacheKey) {
                antwort = try? JSONDecoder().decode(KalenderAntwort.self, from: daten)
            }
        }
        let termine = (antwort?.termine ?? []).sorted { $0.start < $1.start }
        let anfragen = antwort?.anfragen ?? 0
        // Zu Beginn UND Ende jedes heutigen Termins neu zeichnen ("Jetzt", "noch N Termine")
        let wechsel = (termine.map(\.start) + termine.map(\.ende)).filter { $0 > jetzt && Datum.kalender.isDate($0, inSameDayAs: jetzt) }
        let zeiten = [jetzt] + Array(Set(wechsel)).sorted().prefix(24)
        return zeiten.map { KalenderEntry(date: $0, termine: termine, anfragen: anfragen, angemeldet: true) }
    }

    private func abrufen(token: String) async throws -> KalenderAntwort? {
        guard let url = URL(string: supabaseURL + "/rest/v1/rpc/widget_kalender") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 12
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer " + supabaseAnonKey, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["p_token": token])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        // null = Token ungültig (z. B. abgemeldet oder Konto gewechselt)
        if String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) == "null" {
            throw Abruf.tokenUngueltig
        }
        return try JSONDecoder().decode(KalenderAntwort.self, from: data)
    }
}

// Beispieldaten für die Widget-Galerie und den Platzhalter
enum Beispiel {
    static func entry() -> KalenderEntry {
        let k = Datum.kalender
        let heute = k.startOfDay(for: Date())
        func t(_ id: String, _ tag: Int, _ h: Int, _ m: Int, _ dauer: Int, _ art: String, _ titel: String, ort: String? = nil, typ: String = "termin") -> Termin {
            let s = k.date(byAdding: DateComponents(day: tag, hour: h, minute: m), to: heute) ?? heute
            let iso = ISO8601DateFormatter()
            return Termin(id: id, start_at: iso.string(from: s), end_at: iso.string(from: s.addingTimeInterval(Double(dauer) * 60)), art: art, typ: typ, titel: titel, ort: ort, storno: nil)
        }
        let jetzt = k.date(byAdding: DateComponents(hour: 13, minute: 20), to: heute) ?? Date()
        return KalenderEntry(date: jetzt, termine: [
            t("1", 0, 8, 0, 90, "ÜST", "Lena Berger"),
            t("2", 0, 11, 0, 45, "GF", "Jonas Weber"),
            t("3", 0, 14, 0, 135, "AB", "Ida Lorenz", ort: "Bahnhof Nord"),
            t("4", 0, 16, 30, 45, "ÜST", "Marie Kranz"),
            t("5", 0, 18, 0, 90, "TH", "Theorie: Vorfahrt"),
            t("6", 1, 7, 30, 90, "ÜL", "Mia Hoffmann"),
            t("7", 1, 10, 0, 45, "PF", "Jonas Weber"),
            t("8", 2, 9, 0, 45, "ÜST", "Paul Schmidt"),
        ], anfragen: 3, angemeldet: true)
    }
}

// MARK: - Bausteine

private struct Streifen: View {
    let farbe: Color
    var body: some View { RoundedRectangle(cornerRadius: 2, style: .continuous).fill(farbe).frame(width: 4) }
}

private struct TerminZeile: View {
    let t: Termin
    var kompakt = false
    var body: some View {
        HStack(spacing: 8) {
            Streifen(farbe: t.farbe)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(t.istUrlaub ? "ganztägig" : Datum.uhr(t.start))
                        .font(.system(size: kompakt ? 12 : 13, weight: .semibold, design: .rounded)).monospacedDigit()
                        .foregroundStyle(.secondary)
                    Text(t.name).font(.system(size: kompakt ? 13 : 14, weight: .semibold)).lineLimit(1)
                        .foregroundStyle(t.istPrivat ? .secondary : .primary)
                }
                if !kompakt, let zusatz = zusatz {
                    Text(zusatz).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
    private var zusatz: String? {
        let teile = [t.artKurz, t.istUrlaub ? nil : "bis " + Datum.uhr(t.ende), t.storno == true ? "Storno angefragt" : nil, t.ort].compactMap { $0 }
        return teile.isEmpty ? nil : teile.joined(separator: " · ")
    }
}

private struct Kopf: View {
    let entry: KalenderEntry
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(Datum.format(entry.date, "EEEE")).font(.system(size: 13, weight: .bold)).foregroundStyle(markenOrange)
            Text(Datum.format(entry.date, "d. MMMM")).font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            if entry.anfragen > 0 { AnfragenMarke(n: entry.anfragen) }
        }
    }
}

private struct AnfragenMarke: View {
    let n: Int
    var body: some View {
        Text(n == 1 ? "1 Anfrage" : "\(n) Anfragen")
            .font(.system(size: 10.5, weight: .bold))
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(markenOrange.opacity(0.18)))
            .foregroundStyle(markenOrange)
    }
}

private struct Leer: View {
    let titel: String
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(titel).font(.system(size: 15, weight: .bold))
            Text(text).font(.system(size: 12.5)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Größen

struct KleinView: View {
    let entry: KalenderEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(Datum.format(entry.date, "EE")).font(.system(size: 12, weight: .bold)).foregroundStyle(markenOrange).textCase(.uppercase)
                Text(Datum.format(entry.date, "d.")).font(.system(size: 12, weight: .bold))
                Spacer()
                if entry.heuteKommend.count > 0 {
                    Text("\(entry.heuteKommend.count)").font(.system(size: 12, weight: .bold, design: .rounded))
                        .padding(.horizontal, 6).padding(.vertical, 1).background(Capsule().fill(Color.primary.opacity(0.08)))
                }
            }
            Spacer(minLength: 6)
            if let t = entry.naechster {
                let istHeute = Datum.kalender.isDate(t.start, inSameDayAs: entry.date)
                Text(istHeute ? (t.start <= entry.date ? "Jetzt" : "Als Nächstes") : Datum.tagLabel(t.start, jetzt: entry.date))
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
                Text(Datum.uhr(t.start)).font(.system(size: 30, weight: .bold, design: .rounded)).monospacedDigit()
                    .minimumScaleFactor(0.8).lineLimit(1)
                HStack(spacing: 6) {
                    Streifen(farbe: t.farbe).frame(height: 30)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(t.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                        Text([t.artKurz, "bis " + Datum.uhr(t.ende)].compactMap { $0 }.joined(separator: " · "))
                            .font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            } else {
                Leer(titel: entry.urlaubHeute ? "Urlaub" : "Frei", text: "Keine weiteren Termine in den nächsten Tagen.")
            }
        }
    }
}

struct MittelView: View {
    let entry: KalenderEntry
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(Datum.format(entry.date, "EEEE")).font(.system(size: 12, weight: .bold)).foregroundStyle(markenOrange)
                Text(Datum.format(entry.date, "d")).font(.system(size: 40, weight: .bold, design: .rounded)).monospacedDigit()
                Text(Datum.format(entry.date, "MMMM")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Text(zaehler).font(.system(size: 11.5, weight: .medium)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if entry.anfragen > 0 { AnfragenMarke(n: entry.anfragen).padding(.top, 2) }
            }
            .frame(width: 84, alignment: .leading)
            VStack(alignment: .leading, spacing: 7) {
                let liste = zeilen
                if liste.isEmpty {
                    Spacer(minLength: 0)
                    Leer(titel: entry.urlaubHeute ? "Urlaub" : "Frei", text: "Keine Termine in den nächsten Tagen.")
                    Spacer(minLength: 0)
                } else {
                    if let erster = liste.first, !Datum.kalender.isDate(erster.start, inSameDayAs: entry.date) {
                        Text(Datum.tagLabel(erster.start, jetzt: entry.date)).font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary).textCase(.uppercase)
                    }
                    ForEach(liste) { TerminZeile(t: $0) }
                    Spacer(minLength: 0)
                }
            }
        }
    }
    // Rest von heute, sonst der nächste Tag mit Terminen
    private var zeilen: [Termin] {
        if !entry.heuteKommend.isEmpty { return Array(entry.heuteKommend.prefix(3)) }
        guard let n = entry.naechster else { return [] }
        return Array(entry.kommende.filter { Datum.kalender.isDate($0.start, inSameDayAs: n.start) && !$0.istUrlaub }.prefix(3))
    }
    private var zaehler: String {
        let n = entry.heuteKommend.count
        if entry.urlaubHeute && n == 0 { return "Urlaub" }
        return n == 0 ? "Heute frei" : n == 1 ? "noch 1 Termin" : "noch \(n) Termine"
    }
}

struct GrossView: View {
    let entry: KalenderEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Kopf(entry: entry)
            WochenStreifen(entry: entry)
            if gruppen.isEmpty {
                Spacer()
                Leer(titel: "Keine Termine", text: "In den nächsten 7 Tagen ist nichts eingetragen.")
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(gruppen, id: \.0) { gruppe in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(gruppe.0).font(.system(size: 11, weight: .bold)).foregroundStyle(.secondary).textCase(.uppercase)
                            ForEach(gruppe.1) { TerminZeile(t: $0) }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
    // Höchstens 6 Zeilen, nach Tag gruppiert
    private var gruppen: [(String, [Termin])] {
        var rest = 6
        var out: [(String, [Termin])] = []
        for t in entry.kommende where rest > 0 {
            let label = Datum.tagLabel(t.start, jetzt: entry.date)
            if let i = out.firstIndex(where: { $0.0 == label }) { out[i].1.append(t) } else {
                if rest < 2 { break }
                out.append((label, [t]))
            }
            rest -= 1
        }
        return out
    }
}

// Sieben Tage mit Anzahl Terminen als Punkte
private struct WochenStreifen: View {
    let entry: KalenderEntry
    var body: some View {
        HStack(spacing: 0) {
            ForEach(0..<7, id: \.self) { i in
                let tag = Datum.kalender.date(byAdding: .day, value: i, to: Datum.kalender.startOfDay(for: entry.date)) ?? entry.date
                let n = entry.termine.filter { Datum.kalender.isDate($0.start, inSameDayAs: tag) && !$0.istUrlaub && !$0.istPrivat }.count
                let urlaub = entry.termine.contains { Datum.kalender.isDate($0.start, inSameDayAs: tag) && $0.istUrlaub }
                VStack(spacing: 3) {
                    Text(Datum.format(tag, "EEEEE")).font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                    Text(Datum.format(tag, "d")).font(.system(size: 13, weight: .bold, design: .rounded))
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(i == 0 ? markenOrange : Color.clear))
                        .foregroundStyle(i == 0 ? Color.black : Color.primary)
                    HStack(spacing: 2) {
                        if urlaub {
                            Capsule().fill(Color(red: 0.85, green: 0.6, blue: 0.1)).frame(width: 10, height: 4)
                        } else {
                            ForEach(0..<min(n, 4), id: \.self) { _ in Circle().fill(markenOrange).frame(width: 4, height: 4) }
                        }
                    }
                    .frame(height: 4)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

// Sperrbildschirm
struct SperrRechteckView: View {
    let entry: KalenderEntry
    var body: some View {
        if let t = entry.naechster {
            VStack(alignment: .leading, spacing: 1) {
                Text(Datum.kalender.isDate(t.start, inSameDayAs: entry.date) ? Datum.uhr(t.start) + " – " + Datum.uhr(t.ende) : Datum.tagLabel(t.start, jetzt: entry.date) + " " + Datum.uhr(t.start))
                    .font(.system(size: 13, weight: .semibold)).widgetAccentable()
                Text(t.name).font(.system(size: 15, weight: .bold)).lineLimit(1)
                Text([t.artKurz, t.ort].compactMap { $0 }.joined(separator: " · ")).font(.system(size: 12)).lineLimit(1).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text("Keine Termine").font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct SperrZeileView: View {
    let entry: KalenderEntry
    var body: some View {
        if let t = entry.naechster {
            Text(Datum.uhr(t.start) + " " + t.name)
        } else {
            Text("Keine Termine")
        }
    }
}

struct SperrRundView: View {
    let entry: KalenderEntry
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text("\(entry.heuteKommend.count)").font(.system(size: 20, weight: .bold, design: .rounded))
                Text("heute").font(.system(size: 9, weight: .semibold))
            }
        }
    }
}

struct KalenderWidgetView: View {
    var entry: KalenderEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        if !entry.angemeldet {
            switch family {
            case .accessoryInline: Text("Allindrive: bitte anmelden")
            case .accessoryCircular, .accessoryRectangular: Text("Bitte in der App anmelden").font(.system(size: 12))
            default: Leer(titel: "Allindrive", text: "Öffne die App und melde dich an, dann erscheinen hier deine Termine.")
            }
        } else {
            switch family {
            case .systemSmall: KleinView(entry: entry)
            case .systemMedium: MittelView(entry: entry)
            case .systemLarge: GrossView(entry: entry)
            case .accessoryRectangular: SperrRechteckView(entry: entry)
            case .accessoryInline: SperrZeileView(entry: entry)
            case .accessoryCircular: SperrRundView(entry: entry)
            default: MittelView(entry: entry)
            }
        }
    }
}

struct TodayWidget: Widget {
    let kind: String = "TodayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            KalenderWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Kalender")
        .description("Deine nächsten Termine – heute und die kommenden Tage.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

@main
struct TodayWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
    }
}
