// package: ranke / taxonomy
// type:    logic
// job:     the encoding (MIME media-type) vocabulary — the closed top-level class set with compact
// aliases, well-known subtype aliases with two-way resolution, the class constructors, and
// named constants for the popular media types
// limits:  vocabulary + alias resolution only; the codec applies the aliases into the canonical
// bytes and the node holds the value (-> codec, node)

/**
 * IsTextEncoding reports whether a media type carries human-legible text —
 * text/*, message/* (e.g. rfc822), and structured-text application types
 * (application/json, application/xml, and any +json / +xml suffix). Binary types
 * (image/audio/video/font, application/octet-stream, …) return false. An empty
 * encoding is treated as non-text.
 */
export function IsTextEncoding(encoding: string): boolean {
  if (encoding === '') return false
  return (
    encoding.startsWith('text/') ||
    encoding.startsWith('message/') ||
    encoding.endsWith('+json') ||
    encoding.endsWith('+xml') ||
    encoding === EncodingJSON ||
    encoding === EncodingXML
  )
}

// --- Top-level class vocabulary (RFC 6838 media types; the subtype is open) ---

export const encApplication = 'application'
export const encApplicationAlias = 'a'
export const encAudio = 'audio'
export const encAudioAlias = 'A'
export const encExample = 'example'
export const encExampleAlias = 'e'
export const encFont = 'font'
export const encFontAlias = 'f'
export const encImage = 'image'
export const encImageAlias = 'i'
export const encMessage = 'message'
export const encMessageAlias = 'm'
export const encModel = 'model'
export const encModelAlias = 'l'
export const encMultipart = 'multipart'
export const encMultipartAlias = 'M'
export const encText = 'text'
export const encTextAlias = 't'
export const encVideo = 'video'
export const encVideoAlias = 'V'

/**
 * EncodingClass is the closed top-level MIME vocabulary (RFC 6838 media types);
 * the subtype is open.
 */
export type EncodingClass =
  | typeof encApplication
  | typeof encAudio
  | typeof encExample
  | typeof encFont
  | typeof encImage
  | typeof encMessage
  | typeof encModel
  | typeof encMultipart
  | typeof encText
  | typeof encVideo

/** EncodingClasses lists every encoding class, for validation and enumeration. */
export const EncodingClasses: readonly EncodingClass[] = [
  encApplication,
  encAudio,
  encExample,
  encFont,
  encImage,
  encMessage,
  encModel,
  encMultipart,
  encText,
  encVideo,
]

/** validEncodingClass narrows an untrusted string to the closed vocabulary. */
export function validEncodingClass(c: string): c is EncodingClass {
  return (EncodingClasses as readonly string[]).includes(c)
}

/**
 * encodingClassToAlias / encodingClassFromAlias convert the closed MIME top-level
 * types; unknown values pass through unchanged.
 */
export function encodingClassToAlias(c: string): string {
  switch (c) {
    case encApplication:
      return encApplicationAlias
    case encAudio:
      return encAudioAlias
    case encExample:
      return encExampleAlias
    case encFont:
      return encFontAlias
    case encImage:
      return encImageAlias
    case encMessage:
      return encMessageAlias
    case encModel:
      return encModelAlias
    case encMultipart:
      return encMultipartAlias
    case encText:
      return encTextAlias
    case encVideo:
      return encVideoAlias
    default:
      return c
  }
}

export function encodingClassFromAlias(c: string): string {
  switch (c) {
    case encApplicationAlias:
      return encApplication
    case encAudioAlias:
      return encAudio
    case encExampleAlias:
      return encExample
    case encFontAlias:
      return encFont
    case encImageAlias:
      return encImage
    case encMessageAlias:
      return encMessage
    case encModelAlias:
      return encModel
    case encMultipartAlias:
      return encMultipart
    case encTextAlias:
      return encText
    case encVideoAlias:
      return encVideo
    default:
      return c
  }
}

// --- Subtype vocabulary (open, with compact aliases for well-known types) ---

/**
 * EncodingSubtype is the open second-level media type. Every well-known subtype
 * carries a compact alias resolved two ways for the canonical encoding.
 */
export type EncodingSubtype = string

/**
 * encodingSubAliases gives every predefined subtype a single-character alias (one
 * of [a-zA-Z0-9], like the class aliases): a predefined type earns its keep only by
 * encoding compactly (§180), so every one carries an alias. The codec adds the
 * reserved "." prefix on the wire, and a literal subtype can never start with "."
 * (RFC 6838), so an alias and a literal never collide. Subtype aliases live in
 * their own field, so they may reuse letters the class aliases use; the full type's
 * compact form is class-char + sub-char.
 *
 * APPEND ONLY, never re-map an entry: ids are computed over the aliased bytes, so
 * changing a mapping would change the ids of already-stored claims. The
 * single-character space caps the table at 62 entries (56 used). This table is
 * identical to ranke-go's, which is what makes the two agree byte for byte.
 */
const encodingSubAliases: ReadonlyMap<EncodingSubtype, EncodingSubtype> = new Map([
  // application/*
  ['json', 'j'],
  ['ld+json', 'J'],
  ['xml', 'x'],
  ['xhtml+xml', 'X'],
  ['pdf', 'p'],
  ['octet-stream', 'o'],
  ['manifest+json', 'w'],
  ['rtf', 'r'],
  ['zip', 'z'],
  ['gzip', 'g'],
  ['x-tar', 't'],
  ['x-bzip2', 'b'],
  ['x-7z-compressed', '7'],
  ['vnd.rar', 'R'],
  ['java-archive', 'k'],
  ['epub+zip', 'e'],
  ['msword', 'W'],
  ['vnd.ms-excel', 'E'],
  ['vnd.ms-powerpoint', 'Y'],
  ['vnd.openxmlformats-officedocument.wordprocessingml.document', 'd'],
  ['vnd.openxmlformats-officedocument.spreadsheetml.sheet', 's'],
  ['vnd.openxmlformats-officedocument.presentationml.presentation', 'P'],
  ['vnd.oasis.opendocument.text', 'T'],
  ['vnd.oasis.opendocument.spreadsheet', 'S'],
  ['vnd.oasis.opendocument.presentation', 'Q'],
  // text/*
  ['plain', 'n'],
  ['html', 'h'],
  ['css', 'c'],
  ['javascript', 'a'],
  ['csv', 'v'],
  ['markdown', 'm'],
  ['calendar', 'l'],
  // image/*
  ['png', 'G'],
  ['apng', 'A'],
  ['jpeg', 'i'],
  ['gif', 'f'],
  ['webp', 'B'],
  ['avif', 'V'],
  ['svg+xml', 'y'],
  ['bmp', 'M'],
  ['tiff', 'F'],
  ['vnd.microsoft.icon', 'I'],
  // audio/* (mpeg, ogg, webm are shared with video/* — one sub, one alias)
  ['mpeg', 'q'],
  ['aac', 'C'],
  ['wav', 'U'],
  ['ogg', 'O'],
  ['webm', 'K'],
  ['midi', 'D'],
  // video/*
  ['mp4', '4'],
  ['x-msvideo', 'Z'],
  ['mp2t', '2'],
  ['3gpp', '3'],
  // font/*
  ['woff', 'L'],
  ['woff2', 'H'],
  ['ttf', '5'],
  ['otf', '6'],
])

// encodingSubFromAliasMap is the reverse of encodingSubAliases, built once.
const encodingSubFromAliasMap: ReadonlyMap<EncodingSubtype, EncodingSubtype> = new Map(
  [...encodingSubAliases].map(([full, alias]) => [alias, full]),
)

/**
 * encodingSubToAlias / encodingSubFromAlias convert well-known subtypes to and from
 * their bare compact alias (`V-ALIAS`); unknown values pass through unchanged.
 */
export function encodingSubToAlias(s: string): string {
  return encodingSubAliases.get(s) ?? s
}

export function encodingSubFromAlias(s: string): string {
  return encodingSubFromAliasMap.get(s) ?? s
}

/** encodingSubAliasCount is the table's size, which its test holds to the cap. */
export const encodingSubAliasCount = encodingSubAliases.size

// --- Class constructors ---

const encType = (cls: EncodingClass, sub: string): string => `${cls}/${sub}`

/** EncodingApplication returns the "application/<sub>" media type. */
export const EncodingApplication = (sub: string): string => encType(encApplication, sub)
/** EncodingAudio returns the "audio/<sub>" media type. */
export const EncodingAudio = (sub: string): string => encType(encAudio, sub)
/** EncodingExample returns the "example/<sub>" media type. */
export const EncodingExample = (sub: string): string => encType(encExample, sub)
/** EncodingFont returns the "font/<sub>" media type. */
export const EncodingFont = (sub: string): string => encType(encFont, sub)
/** EncodingImage returns the "image/<sub>" media type. */
export const EncodingImage = (sub: string): string => encType(encImage, sub)
/** EncodingMessage returns the "message/<sub>" media type. */
export const EncodingMessage = (sub: string): string => encType(encMessage, sub)
/** EncodingModel returns the "model/<sub>" media type. */
export const EncodingModel = (sub: string): string => encType(encModel, sub)
/** EncodingMultipart returns the "multipart/<sub>" media type. */
export const EncodingMultipart = (sub: string): string => encType(encMultipart, sub)
/** EncodingText returns the "text/<sub>" media type. */
export const EncodingText = (sub: string): string => encType(encText, sub)
/** EncodingVideo returns the "video/<sub>" media type. */
export const EncodingVideo = (sub: string): string => encType(encVideo, sub)

// --- Named media-type constants (the popular MDN/IANA "common types" set) ---
//
// Each names a full media type so callers write EncodingJSON rather than
// EncodingApplication("json"); each equals what the matching class constructor
// produces, so they are interchangeable. For a type not listed, call the class
// constructor directly, e.g. EncodingApplication("vnd.custom+json").

// Application media types (application/*): structured data, documents, archives.
export const EncodingJSON = 'application/json'
export const EncodingJSONLD = 'application/ld+json'
export const EncodingXML = 'application/xml'
export const EncodingXHTML = 'application/xhtml+xml'
export const EncodingPDF = 'application/pdf'
export const EncodingOctetStream = 'application/octet-stream'
export const EncodingWebManifest = 'application/manifest+json'
export const EncodingRTF = 'application/rtf'

// Archives / compression.
export const EncodingZIP = 'application/zip'
export const EncodingGZIP = 'application/gzip'
export const EncodingTAR = 'application/x-tar'
export const EncodingBzip2 = 'application/x-bzip2'
export const Encoding7Z = 'application/x-7z-compressed'
export const EncodingRAR = 'application/vnd.rar'
export const EncodingJAR = 'application/java-archive'
export const EncodingEPUB = 'application/epub+zip'

// Office / OpenDocument.
export const EncodingMSWord = 'application/msword'
export const EncodingMSExcel = 'application/vnd.ms-excel'
export const EncodingMSPowerPoint = 'application/vnd.ms-powerpoint'
export const EncodingDOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const EncodingXLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const EncodingPPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
export const EncodingODT = 'application/vnd.oasis.opendocument.text'
export const EncodingODS = 'application/vnd.oasis.opendocument.spreadsheet'
export const EncodingODP = 'application/vnd.oasis.opendocument.presentation'

// Text media types (text/*).
export const EncodingPlain = 'text/plain'
export const EncodingHTML = 'text/html'
export const EncodingCSS = 'text/css'
export const EncodingJavaScript = 'text/javascript'
export const EncodingCSV = 'text/csv'
export const EncodingMarkdown = 'text/markdown'
export const EncodingCalendar = 'text/calendar'

// Image media types (image/*).
export const EncodingPNG = 'image/png'
export const EncodingAPNG = 'image/apng'
export const EncodingJPEG = 'image/jpeg'
export const EncodingGIF = 'image/gif'
export const EncodingWebP = 'image/webp'
export const EncodingAVIF = 'image/avif'
export const EncodingSVG = 'image/svg+xml'
export const EncodingBMP = 'image/bmp'
export const EncodingTIFF = 'image/tiff'
export const EncodingICO = 'image/vnd.microsoft.icon'

// Audio media types (audio/*).
export const EncodingMP3 = 'audio/mpeg'
export const EncodingAAC = 'audio/aac'
export const EncodingWAV = 'audio/wav'
export const EncodingOggAudio = 'audio/ogg'
export const EncodingWebmAudio = 'audio/webm'
export const EncodingMIDI = 'audio/midi'

// Video media types (video/*).
export const EncodingMP4 = 'video/mp4'
export const EncodingMPEG = 'video/mpeg'
export const EncodingWebmVideo = 'video/webm'
export const EncodingOggVideo = 'video/ogg'
export const EncodingAVI = 'video/x-msvideo'
export const EncodingMP2T = 'video/mp2t'
export const Encoding3GP = 'video/3gpp'

// Font media types (font/*).
export const EncodingWOFF = 'font/woff'
export const EncodingWOFF2 = 'font/woff2'
export const EncodingTTF = 'font/ttf'
export const EncodingOTF = 'font/otf'
