export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface TextRegion extends BoundingBox {
  confidence: number
  classId: number
  /** DEIMモデルが推定した文字数カテゴリ (30/50/100) */
  charCountCategory?: number
}

export interface TextBlock extends BoundingBox {
  text: string
  confidence: number
  classId: number
  readingOrder: number
  /** 縦書きかどうか */
  isVertical?: boolean
}

export interface PageBlock extends BoundingBox {}

export interface LayoutDetectionResult {
  lines: TextRegion[]
  blocks: PageBlock[]
}

export interface OCRResult {
  id: string
  textBlocks: TextBlock[]
  /** ページ全体の読み取りテキスト（読み順に結合） */
  fullText: string
  processingTimeMs: number
}

export interface ProcessedImage {
  id: string
  /** 表示用 data URL */
  dataUrl: string
  width: number
  height: number
  /** PDFページ番号（PDF入力時） */
  pdfPageIndex?: number
}

export type OCRStatus =
  | 'idle'
  | 'loading_model'
  | 'processing'
  | 'done'
  | 'error'

export interface ModelProgress {
  layout: number
  rec30: number
  rec50: number
  rec100: number
}

export interface OCRJobState {
  status: OCRStatus
  currentFileIndex: number
  totalFiles: number
  stageProgress: number
  modelProgress: ModelProgress
  error?: string
}

/** LLMプロバイダーの種類 */
export type LLMProvider = 'openai' | 'anthropic' | 'ollama' | 'custom'

export interface LLMSettings {
  provider: LLMProvider
  apiKey: string
  /** カスタムエンドポイントURL (ollama / custom 用) */
  baseUrl: string
  model: string
  /** プロバイダーごとのデフォルトモデル */
  systemPrompt: string
}

export interface PageState {
  id: string
  image: ProcessedImage
  ocrResult?: OCRResult
  /** LLMで校正済みテキスト */
  correctedText?: string
  status: 'idle' | 'ocr_running' | 'ocr_done' | 'llm_running' | 'llm_done' | 'error'
  error?: string
}
