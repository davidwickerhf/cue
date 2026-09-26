// cue-vision: on-device image analysis with Apple's Vision framework.
// Reads a JSON request on stdin: {"images": [paths], "faces": bool, "labels": bool, "text": bool}
// and writes one JSON object per image on stdout (same order):
// {"file", "faces": [{x, y, w, h, confidence}], "labels": [{id, confidence}], "text": [string]}
// Face boxes are shares of the image with the origin at the top left.
import Foundation
import ImageIO
import Vision

struct Request: Decodable {
	let images: [String]
	/** Print the classifier's labels instead (for widening searches). */
	let vocabulary: Bool?
	let faces: Bool?
	let labels: Bool?
	let text: Bool?
}

func load(_ path: String) -> CGImage? {
	guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else { return nil }
	return CGImageSourceCreateImageAtIndex(source, 0, nil)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let request = try? JSONDecoder().decode(Request.self, from: input) else {
	FileHandle.standardError.write("cue-vision: expected {\"images\": [...]} on stdin\n".data(using: .utf8)!)
	exit(2)
}

if request.vocabulary ?? false {
	let labels = (try? VNClassifyImageRequest().supportedIdentifiers()) ?? []
	print(String(data: try! JSONSerialization.data(withJSONObject: labels), encoding: .utf8)!)
	exit(0)
}

for path in request.images {
	var out: [String: Any] = ["file": path]
	guard let image = load(path) else {
		out["error"] = "unreadable"
		print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
		continue
	}
	var requests: [VNRequest] = []
	let faces = VNDetectFaceRectanglesRequest()
	let labels = VNClassifyImageRequest()
	let text = VNRecognizeTextRequest()
	text.recognitionLevel = .fast
	if request.faces ?? true { requests.append(faces) }
	if request.labels ?? false { requests.append(labels) }
	if request.text ?? false { requests.append(text) }
	let handler = VNImageRequestHandler(cgImage: image, options: [:])
	do {
		try handler.perform(requests)
	} catch {
		out["error"] = error.localizedDescription
	}
	if request.faces ?? true {
		out["faces"] = (faces.results ?? []).map { f -> [String: Double] in
			let b = f.boundingBox
			// Vision's origin is the bottom left.
			return ["x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "confidence": Double(f.confidence)]
		}
	}
	if request.labels ?? false {
		out["labels"] = (labels.results ?? [])
			// Keep weaker labels too: "snow" in a hazy shot may only score a few percent.
			.filter { $0.confidence > 0.04 }
			.prefix(25)
			.map { ["id": $0.identifier, "confidence": Double($0.confidence)] }
	}
	if request.text ?? false {
		out["text"] = (text.results ?? []).compactMap { $0.topCandidates(1).first?.string }
	}
	print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
	fflush(stdout)
}
