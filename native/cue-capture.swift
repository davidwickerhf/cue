// cue-capture: records a screen or a window with ScreenCaptureKit, leaving the
// pointer out unless --cursor (the studio look draws its own), into a QuickTime movie.
//   cue-capture --display <CGDirectDisplayID> | --window <CGWindowID> --out <file.mov> [--fps 30] [--cursor]
// Reads commands on stdin, one per line: "pause", "resume", "stop" (or stdin closing).
// Writes JSON lines to stdout:
//   {"k":"started","t":ms}   the first frame, as Unix time in ms (the recording's time zero)
//   {"k":"done"}             the movie is finished
//   {"k":"error","message":…}
import AppKit
import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

func emit(_ object: [String: Any]) {
	if let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) {
		print(line)
		fflush(stdout)
	}
}
func fail(_ message: String) -> Never {
	emit(["k": "error", "message": message])
	exit(1)
}
func now() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

let args = CommandLine.arguments
func value(_ flag: String) -> String? {
	guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
	return args[i + 1]
}
let out = value("--out") ?? ""
if out.isEmpty { fail("--out is required") }
let displayId = value("--display").flatMap { UInt32($0) }
let windowId = value("--window").flatMap { UInt32($0) }
let fps = Int(value("--fps") ?? "30") ?? 30

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
	let queue = DispatchQueue(label: "cue-capture")
	var stream: SCStream?
	var writer: AVAssetWriter?
	var input: AVAssetWriterInput?
	var adaptor: AVAssetWriterInputPixelBufferAdaptor?
	var first: CMTime?
	/// Time spent paused, taken off every later frame.
	var offset = CMTime.zero
	var pausedAt: CMTime?
	var paused = false
	var lastBuffer: CVPixelBuffer?
	var lastTime = CMTime.zero
	var finished = false

	func start() async {
		do {
			let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
			let filter: SCContentFilter
			var size: CGSize
			var scale: CGFloat = 1
			if let id = windowId {
				guard let window = content.windows.first(where: { $0.windowID == id }) else { fail("That window is gone.") }
				filter = SCContentFilter(desktopIndependentWindow: window)
				size = window.frame.size
				let screen = NSScreen.screens.first(where: { $0.frame.intersects(window.frame) }) ?? NSScreen.main
				scale = screen?.backingScaleFactor ?? 2
			} else {
				let id = displayId ?? CGMainDisplayID()
				guard let display = content.displays.first(where: { $0.displayID == id }) else { fail("That screen is gone.") }
				filter = SCContentFilter(display: display, excludingWindows: [])
				size = CGSize(width: display.width, height: display.height)
				let screen = NSScreen.screens.first(where: {
					($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == id
				})
				scale = screen?.backingScaleFactor ?? 2
			}
			let width = Int(size.width * scale) / 2 * 2
			let height = Int(size.height * scale) / 2 * 2
			let config = SCStreamConfiguration()
			config.width = width
			config.height = height
			config.showsCursor = args.contains("--cursor")
			config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
			config.pixelFormat = kCVPixelFormatType_32BGRA
			config.queueDepth = 6

			let url = URL(fileURLWithPath: out)
			try? FileManager.default.removeItem(at: url)
			let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
			let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
				AVVideoCodecKey: AVVideoCodecType.h264,
				AVVideoWidthKey: width,
				AVVideoHeightKey: height,
				AVVideoCompressionPropertiesKey: [
					AVVideoAverageBitRateKey: max(6_000_000, width * height * 3),
					AVVideoExpectedSourceFrameRateKey: fps,
					AVVideoMaxKeyFrameIntervalKey: fps,
				],
			])
			input.expectsMediaDataInRealTime = true
			let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
			writer.add(input)
			guard writer.startWriting() else { fail(writer.error?.localizedDescription ?? "Could not write the movie.") }
			self.writer = writer
			self.input = input
			self.adaptor = adaptor

			let stream = SCStream(filter: filter, configuration: config, delegate: self)
			try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
			try await stream.startCapture()
			self.stream = stream
		} catch {
			fail(error.localizedDescription)
		}
	}

	func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
		guard type == .screen, !finished, sample.isValid else { return }
		// Only complete frames carry a picture (idle frames mean nothing changed).
		guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
			let raw = attachments.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
			let buffer = CMSampleBufferGetImageBuffer(sample)
		else { return }
		let time = CMSampleBufferGetPresentationTimeStamp(sample)
		append(buffer, at: time)
	}

	func append(_ buffer: CVPixelBuffer, at time: CMTime) {
		guard let writer = writer, let input = input, let adaptor = adaptor, !paused else { return }
		if first == nil {
			first = time
			writer.startSession(atSourceTime: .zero)
			emit(["k": "started", "t": now()])
		}
		let at = CMTimeSubtract(CMTimeSubtract(time, first!), offset)
		guard at > lastTime || lastTime == .zero, input.isReadyForMoreMediaData else { return }
		if adaptor.append(buffer, withPresentationTime: at) {
			lastBuffer = buffer
			lastTime = at
		}
	}

	func hostTime() -> CMTime { CMClockGetTime(CMClockGetHostTimeClock()) }

	func pause() {
		queue.async {
			guard !self.paused else { return }
			self.paused = true
			self.pausedAt = self.hostTime()
		}
	}

	func resume() {
		queue.async {
			guard self.paused, let since = self.pausedAt else { return }
			self.offset = CMTimeAdd(self.offset, CMTimeSubtract(self.hostTime(), since))
			self.paused = false
			self.pausedAt = nil
		}
	}

	var stopping = false

	func stop() async {
		// "stop" and stdin closing both end up here; only the first one counts.
		let already = queue.sync { () -> Bool in
			defer { stopping = true }
			return stopping
		}
		if already { return }
		try? await stream?.stopCapture()
		await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
			queue.async {
				self.finished = true
				// Hold the last picture until the end, so a still screen still lasts the whole recording.
				if let first = self.first, let buffer = self.lastBuffer, let adaptor = self.adaptor,
					let input = self.input, input.isReadyForMoreMediaData
				{
					let end = CMTimeSubtract(CMTimeSubtract(self.pausedAt ?? self.hostTime(), first), self.offset)
					if end > self.lastTime { _ = adaptor.append(buffer, withPresentationTime: end) }
				}
				self.input?.markAsFinished()
				if let writer = self.writer, self.first != nil {
					writer.finishWriting { done.resume() }
				} else {
					self.writer?.cancelWriting()
					done.resume()
				}
			}
		}
		emit(["k": "done"])
		exit(0)
	}

	func stream(_ stream: SCStream, didStopWithError error: Error) {
		emit(["k": "error", "message": error.localizedDescription])
		Task { await self.stop() }
	}
}

// A windowless app, so the window server connection is set up.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let recorder = Recorder()
Task { await recorder.start() }
DispatchQueue.global().async {
	while let line = readLine() {
		switch line.trimmingCharacters(in: .whitespaces) {
		case "pause": recorder.pause()
		case "resume": recorder.resume()
		case "stop": Task { await recorder.stop() }
		default: break
		}
	}
	Task { await recorder.stop() }
}
app.run()
