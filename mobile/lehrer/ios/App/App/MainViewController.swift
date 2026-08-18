import UIKit
import WebKit
import Capacitor

// Deaktiviert den elastischen Overscroll-Bounce der WebView direkt an der Quelle.
// Die globale UIScrollView.appearance()-Einstellung reicht nicht, weil Capacitors
// CAPBridgeViewController die WebView erst nach App-Start erzeugt und dabei einen
// eigenen bounces-Wert setzt, der die Appearance-Vorgabe überschreibt.
// WICHTIG: WKWebView (anders als Safari) hat auf iOS KEINEN WKUIDelegate-Callback für
// window.print() - es gibt schlicht keine offizielle API dafür (verifiziert gegen Apples
// Doku: WKUIDelegate listet keine Print-Methode; "webView(_:print:)" existiert nur im
// veralteten macOS-only WebUIDelegate der Legacy-WebView-Klasse, nicht bei WKWebView/iOS).
// Deshalb hier eine eigene, minimale Bridge: die Web-App ruft bei nativer Plattform statt
// window.print() diesen WKScriptMessageHandler auf (siehe doPrint() in index.html), und wir
// drucken darauf mit dem tatsächlich existierenden UIView.viewPrintFormatter() +
// UIPrintInteractionController - das rendert denselben Inhalt inkl. @media print-CSS.
class MainViewController: CAPBridgeViewController, WKScriptMessageHandler {
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = false
        webView?.configuration.userContentController.add(self, name: "nativePrint")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "nativePrint", let webView = webView else { return }
        let printController = UIPrintInteractionController.shared
        printController.printFormatter = webView.viewPrintFormatter()
        printController.present(animated: true, completionHandler: nil)
    }
}
