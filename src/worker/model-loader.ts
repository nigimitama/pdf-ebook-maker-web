/**
 * ONNXモデルのダウンロードとIndexedDBキャッシュ管理
 *
 * 参照: https://github.com/yuta1984/ndlocrlite-web
 */

const DB_NAME = 'PDFEbookMakerDB'
const DB_VERSION = 2
const MODEL_STORE = 'models'
const MODEL_VERSION = '1.0.0'

export interface ModelInfo {
  name: string
  path: string
  /** 文字認識モデルの入力形状 [batch, channel, height, width] */
  inputShape?: [number, number, number, number]
}

export const MODEL_CONFIGS: Record<string, ModelInfo> = {
  layout: {
    name: 'layout',
    path: '/models/deim-s-1024x1024.onnx',
  },
  rec30: {
    name: 'rec30',
    path: '/models/parseq-ndl-30.onnx',
    inputShape: [1, 3, 16, 256],
  },
  rec50: {
    name: 'rec50',
    path: '/models/parseq-ndl-50.onnx',
    inputShape: [1, 3, 16, 384],
  },
  rec100: {
    name: 'rec100',
    path: '/models/parseq-ndl-100.onnx',
    inputShape: [1, 3, 16, 768],
  },
}

let db: IDBDatabase | null = null

async function initDB(): Promise<IDBDatabase> {
  if (db) return db

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(MODEL_STORE)) {
        const store = database.createObjectStore(MODEL_STORE, { keyPath: 'key' })
        store.createIndex('version', 'version', { unique: false })
      }
    }

    req.onsuccess = () => {
      db = req.result
      resolve(db)
    }

    req.onerror = () => reject(req.error)
  })
}

async function getModelFromCache(key: string): Promise<ArrayBuffer | null> {
  const database = await initDB()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(MODEL_STORE, 'readonly')
    const store = tx.objectStore(MODEL_STORE)
    const req = store.get(key)

    req.onsuccess = () => {
      const result = req.result
      if (result && result.version === MODEL_VERSION) {
        resolve(result.data as ArrayBuffer)
      } else {
        resolve(null)
      }
    }

    req.onerror = () => reject(req.error)
  })
}

async function saveModelToCache(key: string, data: ArrayBuffer): Promise<void> {
  const database = await initDB()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(MODEL_STORE, 'readwrite')
    const store = tx.objectStore(MODEL_STORE)
    const req = store.put({ key, data, version: MODEL_VERSION, savedAt: Date.now() })

    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function downloadWithProgress(
  url: string,
  onProgress?: (progress: number) => void
): Promise<ArrayBuffer> {
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Failed to fetch model: ${res.status} ${res.statusText}`)
  }

  // SPAフォールバック検出: サーバーがモデルの代わりにHTMLを返した場合
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/html')) {
    throw new Error(`Model file not found (HTML returned): ${url}`)
  }

  const total = Number(res.headers.get('content-length') || 0)
  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0 && onProgress) {
      onProgress(received / total)
    }
  }

  const buffer = new ArrayBuffer(received)
  const view = new Uint8Array(buffer)
  let offset = 0
  for (const chunk of chunks) {
    view.set(chunk, offset)
    offset += chunk.length
  }

  if (onProgress) onProgress(1.0)
  return buffer
}

export async function loadModel(
  modelKey: string,
  onProgress?: (progress: number) => void
): Promise<ArrayBuffer> {
  const config = MODEL_CONFIGS[modelKey]
  if (!config) throw new Error(`Unknown model: ${modelKey}`)

  const cacheKey = `${modelKey}_${MODEL_VERSION}`

  // キャッシュ確認
  const cached = await getModelFromCache(cacheKey)
  if (cached) {
    console.log(`[ModelLoader] Using cached model: ${modelKey}`)
    if (onProgress) onProgress(1.0)
    return cached
  }

  // ダウンロード
  console.log(`[ModelLoader] Downloading model: ${modelKey} from ${config.path}`)
  const data = await downloadWithProgress(config.path, onProgress)

  // キャッシュに保存
  try {
    await saveModelToCache(cacheKey, data)
    console.log(`[ModelLoader] Cached model: ${modelKey}`)
  } catch (e) {
    console.warn(`[ModelLoader] Failed to cache model: ${modelKey}`, e)
  }

  return data
}

export async function clearModelCache(): Promise<void> {
  const database = await initDB()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(MODEL_STORE, 'readwrite')
    const store = tx.objectStore(MODEL_STORE)
    const req = store.clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
