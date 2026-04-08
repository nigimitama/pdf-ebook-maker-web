/**
 * 文字認識ワーカー（並列処理用）
 *
 * デスクトップモードでは複数の認識ワーカーを起動し、
 * レイアウト検出後のクロップ画像を並列処理する。
 *
 * メッセージ:
 *   REC_INIT    - モデルを初期化
 *   REC_PROCESS - クロップ済み画像を認識
 *   REC_TERMINATE - ワーカーを終了
 */

import { loadModel, MODEL_CONFIGS } from './model-loader'
import { TextRecognizer } from './text-recognizer'
import type { RecognitionWorkerInMessage, RecognitionWorkerOutMessage } from '../types/worker'

const recognizer30 = new TextRecognizer(MODEL_CONFIGS.rec30.inputShape)
const recognizer50 = new TextRecognizer(MODEL_CONFIGS.rec50.inputShape)
const recognizer100 = new TextRecognizer(MODEL_CONFIGS.rec100.inputShape)

function post(msg: RecognitionWorkerOutMessage): void {
  self.postMessage(msg)
}

function selectRecognizer(charCountCategory: number): TextRecognizer {
  if (charCountCategory <= 30) return recognizer30
  if (charCountCategory <= 50) return recognizer50
  return recognizer100
}

async function initModels(singleModelMode: boolean): Promise<void> {
  if (singleModelMode) {
    let progress = 0
    const data = await loadModel('rec100', (p) => {
      progress = p
      post({ type: 'REC_PROGRESS', progress: p / 1 })
    })
    await recognizer100.initialize(data)
    console.log('[RecWorker] Single model (rec100) initialized')
  } else {
    const progresses = { rec30: 0, rec50: 0, rec100: 0 }
    const reportProgress = () => {
      const avg = (progresses.rec30 + progresses.rec50 + progresses.rec100) / 3
      post({ type: 'REC_PROGRESS', progress: avg })
    }

    await Promise.all([
      loadModel('rec30', (p) => { progresses.rec30 = p; reportProgress() })
        .then(data => recognizer30.initialize(data)),
      loadModel('rec50', (p) => { progresses.rec50 = p; reportProgress() })
        .then(data => recognizer50.initialize(data)),
      loadModel('rec100', (p) => { progresses.rec100 = p; reportProgress() })
        .then(data => recognizer100.initialize(data)),
    ])
    console.log('[RecWorker] All recognition models initialized')
  }

  post({ type: 'REC_PROGRESS', progress: 1.0 })
}

self.onmessage = async (event: MessageEvent<RecognitionWorkerInMessage>) => {
  const msg = event.data

  switch (msg.type) {
    case 'REC_INIT':
      try {
        await initModels(msg.singleModelMode ?? false)
      } catch (error) {
        console.error('[RecWorker] Init error:', error)
      }
      break

    case 'REC_PROCESS': {
      try {
        const { jobId, regionIndex, buffer, width, height, charCountCategory } = msg
        const data = new Uint8ClampedArray(buffer)
        const imageData = new ImageData(data, width, height)

        const recognizer = selectRecognizer(charCountCategory)
        const result = await recognizer.recognizeCropped(imageData)

        post({ type: 'REC_DONE', jobId, regionIndex, text: result.text, confidence: result.confidence })
      } catch (error) {
        post({
          type: 'REC_ERROR',
          jobId: msg.jobId,
          regionIndex: msg.regionIndex,
          error: (error as Error).message,
        })
      }
      break
    }

    case 'REC_TERMINATE':
      recognizer30.dispose()
      recognizer50.dispose()
      recognizer100.dispose()
      self.close()
      break
  }
}
