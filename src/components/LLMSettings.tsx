import { useState } from 'react'
import type { LLMSettings, LLMProvider } from '../types/ocr'
import { DEFAULT_SYSTEM_PROMPT, getDefaultModel, testConnection } from '../utils/llm-client'

interface LLMSettingsModalProps {
  settings: LLMSettings
  onSave: (settings: LLMSettings) => void
  onClose: () => void
}

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  openai: 'OpenAI API',
  anthropic: 'Anthropic API (Claude)',
  ollama: 'Ollama (ローカル)',
  custom: 'カスタム（OpenAI互換）',
}

const PROVIDER_MODELS: Record<LLMProvider, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'],
  ollama: ['qwen2.5:1.5b', 'qwen2.5:3b', 'llama3.2:3b', 'gemma2:2b', 'phi3.5:mini'],
  custom: [],
}

export function LLMSettingsModal({ settings, onSave, onClose }: LLMSettingsModalProps) {
  const [draft, setDraft] = useState<LLMSettings>({ ...settings })
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<'ok' | 'ng' | null>(null)

  const update = (patch: Partial<LLMSettings>) => setDraft(prev => ({ ...prev, ...patch }))

  const handleProviderChange = (provider: LLMProvider) => {
    update({
      provider,
      model: getDefaultModel(provider),
      baseUrl: provider === 'ollama' ? 'http://localhost:11434' : '',
    })
    setTestResult(null)
  }

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)
    const ok = await testConnection(draft)
    setTestResult(ok ? 'ok' : 'ng')
    setIsTesting(false)
  }

  const models = PROVIDER_MODELS[draft.provider]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>LLM 設定</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* プロバイダー選択 */}
          <div className="form-group">
            <label>プロバイダー</label>
            <div className="radio-group">
              {(Object.keys(PROVIDER_LABELS) as LLMProvider[]).map(p => (
                <label key={p} className="radio-label">
                  <input
                    type="radio"
                    name="provider"
                    value={p}
                    checked={draft.provider === p}
                    onChange={() => handleProviderChange(p)}
                  />
                  {PROVIDER_LABELS[p]}
                </label>
              ))}
            </div>
          </div>

          {/* Ollama / カスタムエンドポイント URL */}
          {(draft.provider === 'ollama' || draft.provider === 'custom') && (
            <div className="form-group">
              <label>エンドポイント URL</label>
              {draft.provider === 'ollama' && (
                <p className="form-hint">
                  Ollama は CPU で動く軽量 LLM をローカル実行できます。<br />
                  <code>ollama pull qwen2.5:1.5b</code> などでモデルをダウンロードしてください。
                </p>
              )}
              <input
                type="text"
                value={draft.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value })}
                placeholder={draft.provider === 'ollama' ? 'http://localhost:11434' : 'https://your-endpoint/v1'}
              />
            </div>
          )}

          {/* API キー */}
          {(draft.provider === 'openai' || draft.provider === 'anthropic' || draft.provider === 'custom') && (
            <div className="form-group">
              <label>API キー</label>
              <input
                type="password"
                value={draft.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder={draft.provider === 'ollama' ? '（不要）' : 'sk-...'}
                autoComplete="off"
              />
              <p className="form-hint">API キーはブラウザのメモリにのみ保存され、外部に送信されません。</p>
            </div>
          )}

          {/* モデル選択 */}
          <div className="form-group">
            <label>モデル</label>
            {models.length > 0 ? (
              <select
                value={draft.model}
                onChange={(e) => update({ model: e.target.value })}
              >
                {models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={draft.model}
                onChange={(e) => update({ model: e.target.value })}
                placeholder="モデル名を入力"
              />
            )}
          </div>

          {/* システムプロンプト */}
          <div className="form-group">
            <label>システムプロンプト</label>
            <textarea
              className="text-area small"
              value={draft.systemPrompt}
              onChange={(e) => update({ systemPrompt: e.target.value })}
              rows={6}
            />
            <button
              className="btn btn-sm"
              style={{ marginTop: 4 }}
              onClick={() => update({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}
            >
              デフォルトに戻す
            </button>
          </div>

          {/* 接続テスト */}
          <div className="form-group">
            <div className="test-connection">
              <button
                className="btn btn-sm btn-secondary"
                onClick={handleTest}
                disabled={isTesting}
              >
                {isTesting ? 'テスト中...' : '接続テスト'}
              </button>
              {testResult === 'ok' && <span className="test-ok">✅ 接続成功</span>}
              {testResult === 'ng' && <span className="test-ng">❌ 接続失敗（URLまたはAPIキーを確認してください）</span>}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>キャンセル</button>
          <button
            className="btn btn-primary"
            onClick={() => { onSave(draft); onClose() }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
