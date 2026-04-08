import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'
import https from 'node:https'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * LLM 動的プロキシプラグイン
 *
 * COEP (require-corp) 環境ではブラウザから外部 URL への fetch がブロックされる。
 * /api/llm-proxy/* へのリクエストを x-llm-target ヘッダーで指定したオリジンへ転送する。
 * これにより Ollama・Bonsai・OpenAI・Anthropic の baseUrl をユーザーが自由に設定できる。
 */
function llmDynamicProxy(): Plugin {
  return {
    name: 'llm-dynamic-proxy',
    configureServer(server) {
      server.middlewares.use('/api/llm-proxy', (req: IncomingMessage, res: ServerResponse) => {
        const targetOrigin = req.headers['x-llm-target'] as string | undefined
        if (!targetOrigin) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Missing x-llm-target header' }))
          return
        }

        let targetUrl: URL
        try {
          targetUrl = new URL(req.url || '/', targetOrigin)
        } catch {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Invalid x-llm-target URL' }))
          return
        }

        const isHttps = targetUrl.protocol === 'https:'
        const transport = isHttps ? https : http
        const port = targetUrl.port
          ? parseInt(targetUrl.port, 10)
          : isHttps ? 443 : 80

        const forwardHeaders = { ...req.headers }
        delete forwardHeaders['x-llm-target']
        delete forwardHeaders['host']

        const options: http.RequestOptions = {
          hostname: targetUrl.hostname,
          port,
          path: targetUrl.pathname + targetUrl.search,
          method: req.method,
          headers: {
            ...forwardHeaders,
            host: targetUrl.host,
          },
        }

        const proxyReq = transport.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers)
          proxyRes.pipe(res)
        })

        proxyReq.on('error', (err: NodeJS.ErrnoException) => {
          if (!res.headersSent) {
            res.statusCode = 502
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message, code: err.code }))
          }
        })

        req.pipe(proxyReq)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), llmDynamicProxy()],

  optimizeDeps: {
    exclude: ['onnxruntime-web', 'onnxruntime-web/wasm'],
  },

  assetsInclude: ['**/*.wasm', '**/*.onnx'],

  build: {
    target: 'esnext',
  },

  worker: {
    format: 'es',
  },

  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
