import WidgetKit
import SwiftUI

// Eigener Prozess, keine eigene Supabase-Session moeglich - deshalb der Token-Umweg statt
// eines geteilten Auth-JWT: die Haupt-App legt den Token per App-Group-UserDefaults ab
// (siehe MainViewController.swift, "nativeWidgetToken"), das Widget liest ihn hier wieder aus
// und ruft damit direkt die RPC widget_today_appointments auf. Gleiches Muster wie der
// Kalender-Abo-Link (calendar_feeds), nur fuers Widget statt fuer eine ICS-URL.

private let supabaseURL = "https://oavuftlfnknucxuortar.supabase.co"
private let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hdnVmdGxmbmtudWN4dW9ydGFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzMDQ2NDQsImV4cCI6MjA5Njg4MDY0NH0.5ZoBdQLnJw23dMZ4IKmAauycVcPoVPIZdmNamZ8MEv8"
private let appGroupId = "group.com.allindrive.lehrer"

struct WidgetAppointment: Decodable, Identifiable {
    let student_name: String
    let start_at: String
    let end_at: String?
    let art: String?

    var id: String { start_at + student_name }

    var startDate: Date? {
        ISO8601DateFormatter.supabase.date(from: start_at)
    }
}

private extension ISO8601DateFormatter {
    static let supabase: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

struct TodayEntry: TimelineEntry {
    let date: Date
    let appointments: [WidgetAppointment]
    let hasToken: Bool
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), appointments: [
            WidgetAppointment(student_name: "Max Mustermann", start_at: "", end_at: nil, art: nil)
        ], hasToken: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        Task {
            let token = UserDefaults(suiteName: appGroupId)?.string(forKey: "widgetToken")
            var appointments: [WidgetAppointment] = []
            if let token = token {
                appointments = (try? await fetchAppointments(token: token)) ?? []
            }
            let entry = TodayEntry(date: Date(), appointments: appointments, hasToken: token != nil)
            // Alle 30 Minuten neu laden - reicht fuer einen sich selten aendernden Tagesplan;
            // zusaetzlich stoesst die App selbst nach Login/Kalenderaenderung einen Reload an
            // (WidgetCenter.shared.reloadAllTimelines() in MainViewController.swift).
            let nextUpdate = Date().addingTimeInterval(30 * 60)
            completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
        }
    }

    private func fetchAppointments(token: String) async throws -> [WidgetAppointment] {
        guard let url = URL(string: supabaseURL + "/rest/v1/rpc/widget_today_appointments") else { return [] }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer " + supabaseAnonKey, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["p_token": token])
        let (data, _) = try await URLSession.shared.data(for: request)
        return (try? JSONDecoder().decode([WidgetAppointment].self, from: data)) ?? []
    }
}

struct TodayWidgetEntryView: View {
    var entry: Provider.Entry
    @Environment(\.widgetFamily) var family

    var body: some View {
        if !entry.hasToken {
            emptyState(text: "In der App anmelden, um den Tagesplan zu sehen.")
        } else if entry.appointments.isEmpty {
            emptyState(text: "Heute keine Fahrstunden.")
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("Heute").font(.caption).foregroundColor(.secondary)
                ForEach(visibleAppointments) { appt in
                    HStack(alignment: .top, spacing: 6) {
                        Text(timeLabel(appt)).font(.system(.callout, design: .rounded)).fontWeight(.semibold)
                        Text(appt.student_name).font(.callout).lineLimit(1)
                    }
                }
                if family == .systemSmall && entry.appointments.count > 1 {
                    Text("+\(entry.appointments.count - 1) weitere")
                        .font(.caption2).foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 2)
        }
    }

    private var visibleAppointments: [WidgetAppointment] {
        let limit = family == .systemSmall ? 1 : 4
        return Array(entry.appointments.prefix(limit))
    }

    private func timeLabel(_ appt: WidgetAppointment) -> String {
        guard let d = appt.startDate else { return "--:--" }
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        f.timeZone = TimeZone(identifier: "Europe/Berlin")
        return f.string(from: d)
    }

    private func emptyState(text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Heute").font(.caption).foregroundColor(.secondary)
            Text(text).font(.callout).foregroundColor(.secondary)
        }
        .padding(.horizontal, 2)
    }
}

struct TodayWidget: Widget {
    let kind: String = "TodayWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            TodayWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Heutiger Tag")
        .description("Zeigt deine heutigen Fahrstunden.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct TodayWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
    }
}
