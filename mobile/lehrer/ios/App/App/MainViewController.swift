import UIKit
import Capacitor

// Deaktiviert den elastischen Overscroll-Bounce der WebView direkt an der Quelle.
// Die globale UIScrollView.appearance()-Einstellung reicht nicht, weil Capacitors
// CAPBridgeViewController die WebView erst nach App-Start erzeugt und dabei einen
// eigenen bounces-Wert setzt, der die Appearance-Vorgabe überschreibt.
class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = false
    }
}
