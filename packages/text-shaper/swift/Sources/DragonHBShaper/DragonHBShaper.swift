// Swift over dragon_hb's C ABI (T056 R1): handles in, integers out. Shaped records are copied from dhb_shaper_glyphs
// into [Double] (stride 7: glyph id, cluster, x advance, y advance, x offset, y offset, flags; positions 16.16).
import CDragonHB

public enum DragonHBError: Error, CustomStringConvertible {
    case faceCreateFailed
    case fontCreateFailed
    case shaperCreateFailed
    case outOfMemory
    case badTag(String)

    public var description: String {
        switch self {
        case .faceCreateFailed: return "dhb_face_create failed"
        case .fontCreateFailed: return "dhb_font_create failed"
        case .shaperCreateFailed: return "dhb_shaper_create failed"
        case .outOfMemory: return "dhb_shape: out of memory"
        case .badTag(let t): return "OpenType tag must have 4 ASCII characters: \(t)"
        }
    }
}

public struct DragonHBFeature {
    public let tag: UInt32
    public let value: UInt32
    public let start: UInt32
    public let end: UInt32

    public init(tag: UInt32, value: UInt32, start: UInt32 = 0, end: UInt32 = 0xFFFF_FFFF) {
        self.tag = tag
        self.value = value
        self.start = start
        self.end = end
    }
}

public final class DragonHBFace {
    let handle: OpaquePointer

    /// The bytes are copied by the shim.
    public init(bytes: [UInt8], index: UInt32 = 0) throws {
        guard let h = bytes.withUnsafeBufferPointer({ dhb_face_create($0.baseAddress, UInt32($0.count), index) }) else {
            throw DragonHBError.faceCreateFailed
        }
        handle = h
    }

    deinit { dhb_face_destroy(handle) }

    public var upem: UInt32 { dhb_face_upem(handle) }
}

public final class DragonHBFont {
    let handle: OpaquePointer
    /// The font keeps its face alive.
    public let face: DragonHBFace

    public init(face: DragonHBFace, size: Float, specifiedSize: Float? = nil, weight: Float = 400, width: Float = 100, slope: Float = 0, opticalSizingAuto: Bool = true) throws {
        guard let h = dhb_font_create(face.handle, size, specifiedSize ?? size, weight, width, slope, opticalSizingAuto ? 1 : 0, nil, 0) else {
            throw DragonHBError.fontCreateFailed
        }
        handle = h
        self.face = face
    }

    deinit { dhb_font_destroy(handle) }

    /// The 16.16 advance HarfBuzz gets from the shim's advance function.
    public func glyphAdvance(_ glyph: UInt32) -> Int32 { dhb_font_glyph_advance(handle, glyph) }

    public func nominalGlyph(_ codepoint: UInt32) -> UInt32 { dhb_font_nominal_glyph(handle, codepoint) }
}

public final class DragonHBShaper {
    public static let glyphStride = Int(DHB_GLYPH_STRIDE)
    public static let flagUnsafeToBreak = Int(DHB_GLYPH_FLAG_UNSAFE_TO_BREAK)

    private let handle: OpaquePointer

    public init() throws {
        guard let h = dhb_shaper_create() else { throw DragonHBError.shaperCreateFailed }
        handle = h
    }

    deinit { dhb_shaper_destroy(handle) }

    public static func tag(_ s: String) throws -> UInt32 {
        let b = Array(s.utf8)
        guard b.count == 4, b.allSatisfy({ $0 < 0x80 }) else { throw DragonHBError.badTag(s) }
        return UInt32(b[0]) << 24 | UInt32(b[1]) << 16 | UInt32(b[2]) << 8 | UInt32(b[3])
    }

    /// Shapes text[start, end) (UTF-16 offsets) with the whole text as context. script is an ISO 15924 tag.
    public func shape(font: DragonHBFont, text: [UInt16], start: Int, end: Int, script: String, rtl: Bool, language: String, features: [DragonHBFeature] = []) throws -> [Double] {
        let scriptTag = try DragonHBShaper.tag(script)
        let lang = Array(language.utf8).map { CChar(bitPattern: $0) }
        let feats = features.map { dhb_feature(tag: $0.tag, value: $0.value, start: $0.start, end: $0.end) }
        let n = text.withUnsafeBufferPointer { t in
            lang.withUnsafeBufferPointer { l in
                feats.withUnsafeBufferPointer { f in
                    dhb_shape(handle, font.handle, t.baseAddress, UInt32(t.count), UInt32(start), UInt32(end - start), scriptTag, rtl ? 5 : 4,
                              l.baseAddress, UInt32(l.count), f.count > 0 ? f.baseAddress : nil, UInt32(f.count))
                }
            }
        }
        if n == 0xFFFF_FFFF { throw DragonHBError.outOfMemory }
        let count = Int(n) * DragonHBShaper.glyphStride
        guard count > 0, let g = dhb_shaper_glyphs(handle) else { return [] }
        return (0..<count).map { Double(g[$0]) }
    }
}
