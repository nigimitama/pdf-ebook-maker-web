/**
 * モデルファイルとコンフィグをダウンロードするセットアップスクリプト
 *
 * 使い方: node scripts/download-models.mjs
 *
 * ndlocrlite-web (https://github.com/yuta1984/ndlocrlite-web) の
 * Netlifyデプロイから ONNX モデルと設定ファイルをダウンロードします。
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { pipeline } from 'stream/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ndlocrlite-web の Netlify サイトからダウンロード
// 公式リリースや別のホスティング先に変更することも可能
const BASE_URL = process.env.MODEL_BASE_URL || 'https://ndlocrlite-web.netlify.app'

const FILES = [
  { url: `${BASE_URL}/models/deim-s-1024x1024.onnx`, dest: 'public/models/deim-s-1024x1024.onnx' },
  { url: `${BASE_URL}/models/parseq-ndl-30.onnx`,    dest: 'public/models/parseq-ndl-30.onnx' },
  { url: `${BASE_URL}/models/parseq-ndl-50.onnx`,    dest: 'public/models/parseq-ndl-50.onnx' },
  { url: `${BASE_URL}/models/parseq-ndl-100.onnx`,   dest: 'public/models/parseq-ndl-100.onnx' },
  { url: `${BASE_URL}/config/NDLmoji.yaml`,           dest: 'public/config/NDLmoji.yaml' },
]

async function download(url, destRelative) {
  const dest = path.join(ROOT, destRelative)
  const dir = path.dirname(dest)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  if (existsSync(dest)) {
    console.log(`Skip (already exists): ${destRelative}`)
    return
  }

  console.log(`Downloading: ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`)

  const total = Number(res.headers.get('content-length') || 0)
  let received = 0
  const ws = createWriteStream(dest)

  const progressStream = new TransformStream({
    transform(chunk, controller) {
      received += chunk.length
      if (total > 0) {
        const pct = ((received / total) * 100).toFixed(1)
        process.stdout.write(`\r  ${pct}% (${(received / 1e6).toFixed(1)} MB / ${(total / 1e6).toFixed(1)} MB)`)
      }
      controller.enqueue(chunk)
    },
    flush() {
      process.stdout.write('\n')
    },
  })

  await pipeline(res.body.pipeThrough(progressStream), ws)
  console.log(`  -> Saved: ${destRelative}`)
}

async function main() {
  console.log('=== pdf-ebook-maker-web セットアップ ===\n')
  for (const { url, dest } of FILES) {
    await download(url, dest)
  }
  console.log('\nセットアップ完了！ npm run dev で開発サーバーを起動できます。')
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
