// cue-cursor: records the pointer during a screen recording, for Recordly-style
// cursor, click and zoom effects. Writes JSON lines to stdout until stdin closes:
//   {"t": ms, "x": pt, "y": pt, "k": "move" | "down" | "up"}   (t: Unix time in ms; global points, origin top left)
//   {"t": ms, "k": "bounds", "x", "y", "w", "h"}                (a recorded window, when --window <id>)
// Positions are sampled at 60 Hz; clicks come from a global event monitor.
import AppKit
import Foundation

// Wall-clock time, so the editor can line events up with its own recording clock.
func now() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }
// AppKit's origin is the bottom left of the main screen; flip to the top left.
let mainHeight = NSScreen.screens.first?.frame.height ?? 0
func emit(_ object: [String: Any]) {
	if let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) {
		print(line)
		fflush(stdout)
	}
}
func point(_ kind: String) {
	let p = NSEvent.mouseLocation
	emit(["t": now(), "x": Double(p.x), "y": Double(mainHeight - p.y), "k": kind])
}

var windowId: CGWindowID? = nil
let args = CommandLine.arguments
if let i = args.firstIndex(of: "--window"), i + 1 < args.count, let id = UInt32(args[i + 1]) { windowId = id }

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { _ in point("down") }
NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseUp, .rightMouseUp]) { _ in point("up") }

var last = CGPoint(x: -1, y: -1)
Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { _ in
	let p = NSEvent.mouseLocation
	if p != last {
		last = p
		point("move")
	}
}

var lastBounds = CGRect.zero
if let id = windowId {
	Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in
		guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]],
			let info = list.first, let b = info[kCGWindowBounds as String] as? [String: Double]
		else { return }
		let r = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
		if r != lastBounds {
			lastBounds = r
			emit(["t": now(), "k": "bounds", "x": r.minX, "y": r.minY, "w": r.width, "h": r.height])
		}
	}
}

// Stop when the parent closes stdin.
DispatchQueue.global().async {
	_ = FileHandle.standardInput.readDataToEndOfFile()
	exit(0)
}
point("move")
app.run()
