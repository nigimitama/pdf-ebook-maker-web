/**
 * メインOCRワーカー
 *
 * レイアウト検出 → 文字認識 → 読み順処理 のパイプラインを実行する。
 *
 * メッセージ:
 *   INITIALIZE  - モデルをロードして初期化
 *   OCR_PROCESS - 単一画像のOCR（レイアウト+認識+読み順）
 *   LAYOUT_DETECT - レイアウト検出のみ（クロップ画像をTransferableで返す）
 *   TERMINATE   - ワーカーを終了
 */

import { loadModel, MODEL_CONFIGS } from './model-loader'
import { LayoutDetector } from './layout-detector'
import { TextRecognizer } from './text-recognizer'
import { ReadingOrderProcessor } from './reading-order'
import type { WorkerInMessage, WorkerOutMessage } from '../types/worker'
import type { TextRegion, TextBlock, ModelProgress } from '../types/ocr'

const layoutDetector = new LayoutDetector()
const recognizer30 = new TextRecognizer(MODEL_CONFIGS.rec30.inputShape)
const recognizer50 = new TextRecognizer(MODEL_CONFIGS.rec50.inputShape)
const recognizer100 = new TextRecognizer(MODEL_CONFIGS.rec100.inputShape)
const readingOrderProcessor = new ReadingOrderProcessor()

let isInitialized = false
let isLayoutOnly = false

function postMessage(msg: WorkerOutMessage, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) {
    self.postMessage(msg, transfer)
  } else {
    self.postMessage(msg)
  }
}

async function initialize(layoutOnly: boolean): Promise<void> {
  isLayoutOnly = layoutOnly

  const progress: ModelProgress = { layout: 0, rec30: 0, rec50: 0, rec100: 0 }

  const reportProgress = () => {
    const total = isLayoutOnly
      ? progress.layout
      : (progress.layout + progress.rec30 + progress.rec50 + progress.rec100) / 4

    postMessage({
      type: 'OCR_PROGRESS',
      stage: 'init',
      progress: total,
      modelProgress: { ...progress },
    })
  }

  if (layoutOnly) {
    const layoutData = await loadModel('layout', (p) => {
      progress.layout = p
      reportProgress()
    })
    await layoutDetector.initialize(layoutData)
  } else {
    // デスクトップ: 全モデルを並列ロード
    await Promise.all([
      loadModel('layout', (p) => { progress.layout = p; reportProgress() })
        .then(data => layoutDetector.initialize(data)),
      loadModel('rec30', (p) => { progress.rec30 = p; reportProgress() })
        .then(data => recognizer30.initialize(data)),
      loadModel('rec50', (p) => { progress.rec50 = p; reportProgress() })
        .then(data => recognizer50.initialize(data)),
      loadModel('rec100', (p) => { progress.rec100 = p; reportProgress() })
        .then(data => recognizer100.initialize(data)),
    ])
  }

  isInitialized = true

  postMessage({
    type: 'OCR_PROGRESS',
    stage: 'init',
    progress: 1.0,
    modelProgress: { layout: 1, rec30: 1, rec50: 1, rec100: 1 },
    message: 'モデルの初期化が完了しました',
  })
}

function selectRecognizer(charCountCategory?: number): TextRecognizer {
  if (charCountCategory && charCountCategory <= 30) return recognizer30
  if (charCountCategory && charCountCategory <= 50) return recognizer50
  return recognizer100
}

async function processOCR(jobId: string, imageData: ImageData): Promise<void> {
  const startTime = Date.now()

  try {
    // 1. レイアウト検出
    postMessage({ type: 'OCR_PROGRESS', jobId, stage: 'layout', progress: 0, message: 'レイアウト検出中...' })

    if (!isInitialized) {
      await initialize(false)
    }

    // レイアウトモデルが未初期化の場合はここでロード
    const layoutResult = await layoutDetector.detect(imageData, (p) =>
      postMessage({ type: 'OCR_PROGRESS', jobId, stage: 'layout', progress: p * 0.5 })
    )

    postMessage({ type: 'OCR_PROGRESS', jobId, stage: 'layout', progress: 0.5, message: `${layoutResult.lines.length}行検出` })

    if (layoutResult.lines.length === 0) {
      postMessage({
        type: 'OCR_COMPLETE',
        jobId,
        textBlocks: [],
        fullText: '',
        processingTimeMs: Date.now() - startTime,
      })
      return
    }

    // 2. レイアウト初期結果を TextBlock にマップ（テキストは空）
    const orderedBlocks = readingOrderProcessor.process(layoutResult.lines, layoutResult.blocks)

    // 3. 認識モデルが未初期化の場合はロード（モバイルモードの遅延ロード）
    if (isLayoutOnly && !recognizer100['initialized']) {
      postMessage({ type: 'OCR_PROGRESS', jobId, stage: 'init', progress: 0, message: '認識モデルをロード中...' })
      const [data30, data50, data100] = await Promise.all([
        loadModel('rec30'),
        loadModel('rec50'),
        loadModel('rec100'),
      ])
      await Promise.all([
        recognizer30.initialize(data30),
        recognizer50.initialize(data50),
        recognizer100.initialize(data100),
      ])
    }

    // 4. 文字認識（読み順で処理）
    postMessage({ type: 'OCR_PROGRESS', jobId, stage: 'recognition', progress: 0, message: '文字認識中...' })

    const croppedImages = TextRecognizer.cropImageDataBatch(imageData, orderedBlocks)
    const recognizedBlocks: TextBlock[] = []

    for (let i = 0; i < orderedBlocks.length; i++) {
      const block = orderedBlocks[i]
      const cropped = croppedImages[i]
      const recognizer = selectRecognizer(block.charCountCategory)
      const result = await recognizer.recognizeCropped(cropped)

      recognizedBlocks.push({
        ...block,
        text: result.text,
        confidence: result.confidence,
      })

      postMessage({
        type: 'OCR_PROGRESS',
        jobId,
        stage: 'recognition',
        progress: (i + 1) / orderedBlocks.length,
      })
    }

    // 5. 結果生成
    const fullText = recognizedBlocks
      .sort((a, b) => a.readingOrder - b.readingOrder)
      .map(b => b.text)
      .filter(t => t.length > 0)
      .join('\n')

    postMessage({
      type: 'OCR_COMPLETE',
      jobId,
      textBlocks: recognizedBlocks,
      fullText,
      processingTimeMs: Date.now() - startTime,
    })
  } catch (error) {
    console.error('[OCRWorker] Error:', error)
    postMessage({
      type: 'OCR_ERROR',
      jobId,
      stage: 'processing',
      error: (error as Error).message,
    })
  }
}

async function detectLayout(jobId: string, imageData: ImageData): Promise<void> {
  try {
    postMessage({ type: 'OCR_PROGRESS', jobId, stage: 'layout', progress: 0 })

    const layoutResult = await layoutDetector.detect(imageData, (p) =>
      postMessage({ type: 'OCR_PROGRESS', jobId, stage: 'layout', progress: p })
    )

    // クロップ画像を Transferable で返す（ゼロコピー）
    const croppedImages = TextRecognizer.cropImageDataBatch(imageData, layoutResult.lines)

    const croppedBuffers: ArrayBuffer[] = []
    const croppedWidths: number[] = []
    const croppedHeights: number[] = []

    for (const img of croppedImages) {
      const buffer = img.data.buffer.slice(0)
      croppedBuffers.push(buffer)
      croppedWidths.push(img.width)
      croppedHeights.push(img.height)
    }

    const msg: WorkerOutMessage = {
      type: 'LAYOUT_DONE',
      jobId,
      lines: layoutResult.lines,
      blocks: layoutResult.blocks,
      croppedBuffers,
      croppedWidths,
      croppedHeights,
    }

    postMessage(msg, croppedBuffers)
  } catch (error) {
    console.error('[OCRWorker] Layout detection error:', error)
    postMessage({
      type: 'OCR_ERROR',
      jobId,
      stage: 'layout',
      error: (error as Error).message,
    })
  }
}

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data

  switch (msg.type) {
    case 'INITIALIZE':
      try {
        await initialize(msg.layoutOnly ?? false)
      } catch (error) {
        postMessage({
          type: 'OCR_ERROR',
          jobId: '',
          stage: 'init',
          error: (error as Error).message,
        })
      }
      break

    case 'OCR_PROCESS':
      await processOCR(msg.jobId, msg.imageData)
      break

    case 'LAYOUT_DETECT':
      await detectLayout(msg.jobId, msg.imageData)
      break

    case 'TERMINATE':
      layoutDetector.dispose()
      recognizer30.dispose()
      recognizer50.dispose()
      recognizer100.dispose()
      self.close()
      break
  }
}
