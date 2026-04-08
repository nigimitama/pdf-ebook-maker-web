import type { TextBlock, TextRegion, PageBlock, ModelProgress } from './ocr'

// ---- Main OCR Worker ----

export type WorkerInMessage =
  | { type: 'INITIALIZE'; layoutOnly?: boolean }
  | { type: 'OCR_PROCESS'; jobId: string; imageData: ImageData }
  | {
      type: 'LAYOUT_DETECT'
      jobId: string
      imageData: ImageData
    }
  | { type: 'TERMINATE' }

export type WorkerOutMessage =
  | {
      type: 'OCR_PROGRESS'
      jobId?: string
      stage: 'init' | 'layout' | 'recognition' | 'reading_order'
      progress: number
      message?: string
      modelProgress?: ModelProgress
    }
  | {
      type: 'OCR_COMPLETE'
      jobId: string
      textBlocks: TextBlock[]
      fullText: string
      processingTimeMs: number
    }
  | {
      type: 'OCR_ERROR'
      jobId: string
      stage: string
      error: string
    }
  | {
      type: 'LAYOUT_DONE'
      jobId: string
      lines: TextRegion[]
      blocks: PageBlock[]
      /** 各テキスト領域のクロップ画像バッファ (Transferable) */
      croppedBuffers: ArrayBuffer[]
      croppedWidths: number[]
      croppedHeights: number[]
    }

// ---- Recognition Worker ----

export type RecognitionWorkerInMessage =
  | {
      type: 'REC_INIT'
      singleModelMode?: boolean
    }
  | {
      type: 'REC_PROCESS'
      jobId: string
      regionIndex: number
      buffer: ArrayBuffer
      width: number
      height: number
      charCountCategory: number
    }
  | { type: 'REC_TERMINATE' }

export type RecognitionWorkerOutMessage =
  | {
      type: 'REC_PROGRESS'
      progress: number
    }
  | {
      type: 'REC_DONE'
      jobId: string
      regionIndex: number
      text: string
      confidence: number
    }
  | {
      type: 'REC_ERROR'
      jobId: string
      regionIndex: number
      error: string
    }
