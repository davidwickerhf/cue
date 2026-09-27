// cue-vision: on-device image analysis with Apple's Vision framework.
// Reads a JSON request on stdin: {"images": [paths], "faces": bool, "labels": bool, "text": bool}
// and writes one JSON object per image on stdout (same order):
// {"file", "faces": [{x, y, w, h, confidence}], "labels": [{id, confidence}], "text": [string]}
// Face boxes are shares of the image with the origin at the top left.
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

struct Cutout: Decodable {
	let input: String
	let output: String
	/** White edge round the cut-out, in pixels of the picture. */
	let outline: Double?
	/** Soft shadow under it, 0–1. */
	let shadow: Double?
}

struct Request: Decodable {
	let images: [String]?
	/** Cut the subject out of one picture (a PNG with transparency) instead of analysing. */
	let cutout: Cutout?
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

/** The subject's mask (white where it is), at the picture's size: every foreground
 *  object on macOS 14 and later, people only before that. */
func subjectMask(_ image: CGImage) throws -> CIImage? {
	let handler = VNImageRequestHandler(cgImage: image, options: [:])
	if #available(macOS 14.0, *) {
		let request = VNGenerateForegroundInstanceMaskRequest()
		try handler.perform([request])
		if let result = request.results?.first {
			let buffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
			return CIImage(cvPixelBuffer: buffer)
		}
		return nil
	}
	let request = VNGeneratePersonSegmentationRequest()
	request.qualityLevel = .accurate
	request.outputPixelFormat = kCVPixelFormatType_OneComponent8
	try handler.perform([request])
	guard let buffer = request.results?.first?.pixelBuffer else { return nil }
	let mask = CIImage(cvPixelBuffer: buffer)
	return mask.transformed(by: CGAffineTransform(
		scaleX: CGFloat(image.width) / mask.extent.width, y: CGFloat(image.height) / mask.extent.height))
}

func cutout(_ c: Cutout) -> [String: Any] {
	guard let image = load(c.input) else { return ["error": "unreadable"] }
	let mask: CIImage
	do {
		guard let found = try subjectMask(image) else { return ["error": "No subject found in the picture."] }
		mask = found
	} catch {
		return ["error": error.localizedDescription]
	}
	let context = CIContext()
	let source = CIImage(cgImage: image)
	let extent = source.extent
	let clear = CIImage(color: .clear).cropped(to: extent)
	let alpha = mask.applyingFilter("CIMaskToAlpha")
	var picture = source.applyingFilter("CIBlendWithAlphaMask", parameters: [
		kCIInputBackgroundImageKey: clear, kCIInputMaskImageKey: alpha,
	])
	let outline = max(0, c.outline ?? 0)
	let shadow = min(1, max(0, c.shadow ?? 0))
	let blur = shadow > 0 ? max(6, Double(max(image.width, image.height)) * 0.012) : 0
	let pad = CGFloat(outline + blur * 3 + 4)
	let canvas = extent.insetBy(dx: -pad, dy: -pad)
	// The mask on an empty (black) margin, so growing and blurring it never smears its edges.
	let black = CIImage(color: .black).cropped(to: canvas)
	let padded = mask.composited(over: black)
	// The edge: the mask grown by the outline, in paper white, under the picture.
	var shape = padded
	if outline > 0 {
		shape = padded.applyingFilter("CIMorphologyMaximum", parameters: [kCIInputRadiusKey: outline])
			.cropped(to: canvas)
		let paper = CIImage(color: CIColor(red: 0.98, green: 0.97, blue: 0.94)).cropped(to: canvas)
		let edge = paper.applyingFilter("CIBlendWithAlphaMask", parameters: [
			kCIInputBackgroundImageKey: CIImage(color: .clear).cropped(to: canvas),
			kCIInputMaskImageKey: shape.applyingFilter("CIMaskToAlpha"),
		])
		picture = picture.composited(over: edge)
	}
	// The shadow: the whole shape blurred, a little down and to the right, under everything.
	if shadow > 0 {
		let soft = shape.applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: blur])
			.cropped(to: canvas)
			.transformed(by: CGAffineTransform(translationX: CGFloat(blur * 0.35), y: CGFloat(-blur * 0.6)))
		let dark = CIImage(color: CIColor(red: 0.08, green: 0.06, blue: 0.04, alpha: CGFloat(0.85 * shadow)))
			.cropped(to: canvas)
		let cast = dark.applyingFilter("CIBlendWithAlphaMask", parameters: [
			kCIInputBackgroundImageKey: CIImage(color: .clear).cropped(to: canvas),
			kCIInputMaskImageKey: soft.applyingFilter("CIMaskToAlpha"),
		])
		picture = picture.composited(over: cast)
	}
	// Cropped to what is visible, so the cut-out can be placed and scaled freely.
	guard let rendered = context.createCGImage(picture, from: canvas),
		let bounds = opaqueBounds(rendered),
		let cropped = rendered.cropping(to: bounds)
	else { return ["error": "Could not draw the cut-out."] }
	let url = URL(fileURLWithPath: c.output)
	guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
		return ["error": "Could not write \(c.output)"]
	}
	CGImageDestinationAddImage(dest, cropped, nil)
	guard CGImageDestinationFinalize(dest) else { return ["error": "Could not write \(c.output)"] }
	return ["file": c.output, "width": cropped.width, "height": cropped.height]
}

/** The box round every pixel that is not fully transparent (top-left origin), or nil. */
func opaqueBounds(_ image: CGImage) -> CGRect? {
	let w = image.width
	let h = image.height
	var data = [UInt8](repeating: 0, count: w * h * 4)
	guard let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
		space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
	else { return nil }
	ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
	var minX = w, minY = h, maxX = -1, maxY = -1
	for y in 0..<h {
		for x in 0..<w where data[(y * w + x) * 4 + 3] > 8 {
			if x < minX { minX = x }
			if x > maxX { maxX = x }
			if y < minY { minY = y }
			if y > maxY { maxY = y }
		}
	}
	guard maxX >= minX, maxY >= minY else { return nil }
	return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
}

if let c = request.cutout {
	print(String(data: try! JSONSerialization.data(withJSONObject: cutout(c)), encoding: .utf8)!)
	exit(0)
}

if request.vocabulary ?? false {
	let labels = (try? VNClassifyImageRequest().supportedIdentifiers()) ?? []
	print(String(data: try! JSONSerialization.data(withJSONObject: labels), encoding: .utf8)!)
	exit(0)
}

for path in request.images ?? [] {
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
