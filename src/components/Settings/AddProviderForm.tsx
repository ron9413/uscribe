import { useState, useEffect, useRef } from 'react'
import { AIProvider } from '../../types'

interface AddProviderFormProps {
    onAdd: (provider: AIProvider, apiKey: string) => void
    onCancel: () => void
    isLoading: boolean
    editingProvider?: AIProvider
    existingProviderNames: string[]
    hasStoredApiKey?: boolean
}

interface OllamaModel {
    name: string
    size: number
    modified_at: string
    digest: string
    details?: {
        parameter_size?: string
        quantization_level?: string
        family?: string
    }
}

function AddProviderForm({
    onAdd,
    onCancel,
    isLoading,
    editingProvider,
    existingProviderNames,
    hasStoredApiKey = false,
}: AddProviderFormProps) {
    const MASKED_API_KEY = '********'
    const [formData, setFormData] = useState({
        name: editingProvider?.name || '',
        type: editingProvider?.type || ('openai' as AIProvider['type']),
        apiKey: editingProvider && hasStoredApiKey ? MASKED_API_KEY : '',
        baseUrl: editingProvider?.baseUrl || '',
        model: editingProvider?.model || '',
    })
    const [apiKeyTouched, setApiKeyTouched] = useState(false)

    const [errors, setErrors] = useState<Record<string, string>>({})
    const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
    const [loadingOllamaModels, setLoadingOllamaModels] = useState(false)
    const [showPullDialog, setShowPullDialog] = useState(false)
    const [modelToPull, setModelToPull] = useState('')
    const [pullProgress, setPullProgress] = useState('')
    const [isPulling, setIsPulling] = useState(false)
    const pullAbortControllerRef = useRef<AbortController | null>(null)
    const pullCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [modelToDelete, setModelToDelete] = useState('')
    const [isDeleting, setIsDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState('')

    const modelOptions: Record<AIProvider['type'], string[]> = {
        openai: ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4'],
        azure: [],
        claude: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'],
        ollama: [],
        litellm: [],
    }

    // Fetch Ollama models when type is ollama
    useEffect(() => {
        if (formData.type === 'ollama') {
            fetchOllamaModels()
        }
    }, [formData.type])

    useEffect(() => {
        setFormData({
            name: editingProvider?.name || '',
            type: editingProvider?.type || ('openai' as AIProvider['type']),
            apiKey: editingProvider && hasStoredApiKey ? MASKED_API_KEY : '',
            baseUrl: editingProvider?.baseUrl || '',
            model: editingProvider?.model || '',
        })
        setApiKeyTouched(false)
        setErrors({})
        setModelToPull('')
        setPullProgress('')
        setDeleteError('')
    }, [editingProvider, hasStoredApiKey])

    useEffect(() => {
        return () => {
            pullAbortControllerRef.current?.abort()
            if (pullCloseTimeoutRef.current) {
                clearTimeout(pullCloseTimeoutRef.current)
            }
        }
    }, [])

    const getOllamaApiBaseUrl = () => {
        const base = (formData.baseUrl || editingProvider?.baseUrl || 'http://127.0.0.1:11434')
            .replace(/localhost/ig, '127.0.0.1')
            .replace(/\/+$/, '')

        return base.endsWith('/v1') ? base.slice(0, -3) : base
    }

    const fetchOllamaModels = async () => {
        setLoadingOllamaModels(true)
        try {
            const response = await fetch(`${getOllamaApiBaseUrl()}/api/tags`)

            if (!response.ok) {
                throw new Error('Failed to fetch Ollama models. Is Ollama running?')
            }

            const data = await response.json()
            setOllamaModels(data.models || [])
            setErrors((prev) => ({ ...prev, ollama: '' }))
        } catch (error: any) {
            console.error('Error fetching Ollama models:', error)
            setErrors((prev) => ({ ...prev, ollama: error.message }))
            setOllamaModels([])
        } finally {
            setLoadingOllamaModels(false)
        }
    }

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes'
        const k = 1024
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
    }

    const confirmPullModel = async () => {
        setIsPulling(true)
        setPullProgress('Starting download...')

        try {
            const abortController = new AbortController()
            pullAbortControllerRef.current = abortController

            const response = await fetch(`${getOllamaApiBaseUrl()}/api/pull`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelToPull, stream: true }),
                signal: abortController.signal
            })

            if (!response.ok) {
                throw new Error('Failed to pull model')
            }

            const reader = response.body?.getReader()
            const decoder = new TextDecoder()
            let pendingLine = ''

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    const text = pendingLine + decoder.decode(value, { stream: true })
                    const parts = text.split('\n')
                    pendingLine = parts.pop() || ''
                    const lines = parts.filter(line => line.trim())

                    for (const line of lines) {
                        try {
                            const json = JSON.parse(line)
                            if (json.status) {
                                setPullProgress(json.status)
                                if (json.total && json.completed) {
                                    const percent = Math.round((json.completed / json.total) * 100)
                                    setPullProgress(`${json.status}: ${percent}%`)
                                }
                            }
                        } catch (e) {
                            // Ignore JSON parse errors
                        }
                    }
                }

                // Flush decoder and parse the last pending JSON line if present.
                const finalChunk = pendingLine + decoder.decode()
                if (finalChunk.trim()) {
                    try {
                        const json = JSON.parse(finalChunk)
                        if (json.status) {
                            setPullProgress(
                                json.total && json.completed
                                    ? `${json.status}: ${Math.round((json.completed / json.total) * 100)}%`
                                    : json.status
                            )
                        }
                    } catch (e) {
                        // Ignore trailing JSON parse errors
                    }
                }
            }

            setPullProgress('Download complete!')
            await fetchOllamaModels() // Refresh model list

            // Auto-select the pulled model
            setFormData((prev) => ({ ...prev, model: modelToPull }))

            pullCloseTimeoutRef.current = setTimeout(() => {
                setShowPullDialog(false)
                setIsPulling(false)
                setPullProgress('')
                pullAbortControllerRef.current = null
                pullCloseTimeoutRef.current = null
            }, 1500)
        } catch (error: any) {
            if (error?.name === 'AbortError') {
                setPullProgress('Download canceled')
                setIsPulling(false)
                pullAbortControllerRef.current = null
                return
            }

            console.error('Error pulling model:', error)
            setPullProgress(`Error: ${error.message}`)
            setIsPulling(false)
            pullAbortControllerRef.current = null
        }
    }

    const handleCancelPull = () => {
        if (isPulling) {
            pullAbortControllerRef.current?.abort()
        }
        if (pullCloseTimeoutRef.current) {
            clearTimeout(pullCloseTimeoutRef.current)
            pullCloseTimeoutRef.current = null
        }
        setShowPullDialog(false)
        setModelToPull('')
        setPullProgress('')
    }

    const confirmDeleteModel = async () => {
        setIsDeleting(true)
        setDeleteError('')
        try {
            const response = await fetch(`${getOllamaApiBaseUrl()}/api/delete`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelToDelete }),
            })

            if (!response.ok) {
                const errText = await response.text().catch(() => '')
                throw new Error(errText || `Failed to delete model (${response.status})`)
            }

            await fetchOllamaModels()
            if (formData.model === modelToDelete) {
                setFormData((prev) => ({ ...prev, model: '' }))
            }
            setShowDeleteDialog(false)
            setModelToDelete('')
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to delete model'
            setDeleteError(message)
        } finally {
            setIsDeleting(false)
        }
    }

    const handleCancelDelete = () => {
        if (!isDeleting) {
            setShowDeleteDialog(false)
            setModelToDelete('')
            setDeleteError('')
        }
    }

    const validate = () => {
        const newErrors: Record<string, string> = {}
        const providerTypeChanged = !!editingProvider && editingProvider.type !== formData.type
        const normalizedName = formData.name.trim().toLowerCase()
        const editingName = editingProvider?.name.trim().toLowerCase()
        const typedApiKey = apiKeyTouched ? formData.apiKey.trim() : ''

        if (!formData.name.trim()) {
            newErrors.name = 'Name is required'
        } else {
            const duplicateName = existingProviderNames.some((existingName) => {
                const existingNormalized = existingName.trim().toLowerCase()
                if (isEditMode && editingName && existingNormalized === editingName) {
                    return false
                }
                return existingNormalized === normalizedName
            })

            if (duplicateName) {
                newErrors.name = 'Provider name already exists'
            }
        }

        // API key is required for:
        // - new non-ollama providers
        // - any edit that switches to a different keyed provider type
        if (
            formData.type !== 'ollama' &&
            !typedApiKey &&
            (!isEditMode || providerTypeChanged || !hasStoredApiKey)
        ) {
            newErrors.apiKey = providerTypeChanged
                ? 'API key is required when changing provider type'
                : 'API key is required'
        }

        if (!formData.model) {
            newErrors.model = 'Model is required'
        }

        if (formData.type === 'azure' && !formData.baseUrl.trim()) {
            newErrors.baseUrl = 'Azure endpoint is required'
        }

        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()

        if (!validate()) {
            return
        }

        const provider: AIProvider = {
            name: formData.name,
            type: formData.type,
            model: formData.model,
            baseUrl: formData.baseUrl || undefined,
        }

        const submittedApiKey = isEditMode && !apiKeyTouched ? '' : formData.apiKey
        onAdd(provider, submittedApiKey)
    }

    const handleTypeChange = (type: AIProvider['type']) => {
         setFormData({
            ...formData,
            type,
            model: '',
            baseUrl: '',
        })
    }

    const isEditMode = !!editingProvider

    return (
        <div className={`mt-3 p-4 border rounded-lg ${
            isEditMode
                ? 'border-orange-300 bg-orange-50/50'
                : 'border-gray-300 bg-gray-50'
        }`}>
            <h4 className="text-lg font-semibold mb-4">
                {isEditMode ? 'Edit Provider' : 'Add New Provider'}
            </h4>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium mb-1">
                        Provider Name
                    </label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., My OpenAI"
                        className={`w-full px-3 py-2 border rounded outline-none ${
                            errors.name ? 'border-red-500' : 'border-gray-300'
                        }`}
                    />
                    {errors.name && (
                        <p className="text-sm text-red-600 mt-1">{errors.name}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Type</label>
                    <select
                        value={formData.type}
                        onChange={(e) =>
                            handleTypeChange(e.target.value as AIProvider['type'])
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded outline-none"
                    >
                        <option value="openai">OpenAI</option>
                        <option value="azure">Azure OpenAI</option>
                        <option value="claude">Anthropic Claude</option>
                        <option value="ollama">Ollama (Local)</option>
                        <option value="litellm">LiteLLM</option>
                    </select>
                </div>

                {formData.type !== 'ollama' && (
                    <div>
                        <label className="block text-sm font-medium mb-1">
                            API Key
                            {isEditMode && (
                                <span className="text-xs text-gray-500 ml-2">
                                    {hasStoredApiKey
                                        ? '(stored key masked; type to replace)'
                                        : '(type to set key)'}
                                </span>
                            )}
                        </label>
                        <input
                            type="password"
                            value={formData.apiKey}
                            onChange={(e) => {
                                setApiKeyTouched(true)
                                setFormData({ ...formData, apiKey: e.target.value })
                            }}
                            placeholder={isEditMode ? 'Type new key to replace' : 'sk-...'}
                            className={`w-full px-3 py-2 border rounded outline-none ${
                                errors.apiKey ? 'border-red-500' : 'border-gray-300'
                            }`}
                        />
                        {errors.apiKey && (
                            <p className="text-sm text-red-600 mt-1">{errors.apiKey}</p>
                        )}
                    </div>
                )}

                {(formData.type === 'azure' || formData.type === 'litellm') && (
                    <div>
                        <label className="block text-sm font-medium mb-1">
                            {formData.type === 'azure'
                                ? 'Azure Endpoint'
                                : 'Base URL (optional)'}
                        </label>
                        <input
                            type="text"
                            value={formData.baseUrl}
                            onChange={(e) =>
                                setFormData({ ...formData, baseUrl: e.target.value })
                            }
                            placeholder={
                                formData.type === 'azure'
                                    ? 'https://your-resource.openai.azure.com'
                                    : 'http://localhost:4000 (optional)'
                            }
                            className={`w-full px-3 py-2 border rounded outline-none ${
                                errors.baseUrl ? 'border-red-500' : 'border-gray-300'
                            }`}
                        />
                        {errors.baseUrl && (
                            <p className="text-sm text-red-600 mt-1">{errors.baseUrl}</p>
                        )}
                    </div>
                )}

                {formData.type === 'ollama' ? (
                    <div>
                        <label className="block text-sm font-medium mb-2">
                            Select Model
                        </label>

                        {errors.ollama && (
                            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
                                <p className="font-medium">Ollama Connection Error</p>
                                <p className="mt-1">{errors.ollama}</p>
                                <p className="mt-2 text-xs">Make sure Ollama is running locally.</p>
                            </div>
                        )}

                        {loadingOllamaModels ? (
                            <div className="p-4 text-center text-gray-500 text-sm">
                                Loading models...
                            </div>
                        ) : ollamaModels.length > 0 ? (
                            <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-300 rounded p-2 bg-white mb-3">
                                {ollamaModels.map((model) => {
                                    const isSelectedModel = formData.model === model.name
                                    return (
                                    <div
                                        key={model.name}
                                        className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded"
                                    >
                                        <label className="flex items-center flex-1 min-w-0 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="ollamaModel"
                                                value={model.name}
                                                checked={formData.model === model.name}
                                                onChange={(e) =>
                                                    setFormData({ ...formData, model: e.target.value })
                                                }
                                                className="mr-3 shrink-0"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium truncate">{model.name}</div>
                                                <div className="text-xs text-gray-500">
                                                    {formatBytes(model.size)}
                                                    {model.details?.parameter_size && ` • ${model.details.parameter_size}`}
                                                    {model.details?.quantization_level && ` • ${model.details.quantization_level}`}
                                                </div>
                                            </div>
                                        </label>
                                        <button
                                            type="button"
                                            disabled={isSelectedModel}
                                            aria-label={
                                                isSelectedModel
                                                    ? `Cannot remove ${model.name} while it is selected`
                                                    : `Remove model ${model.name}`
                                            }
                                            title={
                                                isSelectedModel
                                                    ? 'Select another model first to remove this one'
                                                    : 'Remove model'
                                            }
                                            onClick={() => {
                                                if (isSelectedModel) return
                                                setModelToDelete(model.name)
                                                setDeleteError('')
                                                setShowDeleteDialog(true)
                                            }}
                                            className={`shrink-0 p-0.5 rounded flex items-center justify-center ${
                                                isSelectedModel
                                                    ? 'text-gray-300 cursor-not-allowed'
                                                    : 'text-gray-400 hover:text-red-600'
                                            }`}
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                className="w-3.5 h-3.5"
                                                aria-hidden
                                            >
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                <line x1="10" y1="11" x2="10" y2="17" />
                                                <line x1="14" y1="11" x2="14" y2="17" />
                                            </svg>
                                        </button>
                                    </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="p-4 text-center text-gray-500 text-sm border border-gray-300 rounded mb-3">
                                No models downloaded yet
                            </div>
                        )}

                        {errors.model && (
                            <p className="text-sm text-red-600 mb-2">{errors.model}</p>
                        )}

                        {/* Download New Model */}
                        <div className="border-t border-gray-300 pt-3">
                            <p className="text-xs font-medium text-gray-600 mb-2">
                                Pull a new model
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="e.g., llama3.2:latest, mistral:latest"
                                    value={modelToPull}
                                    onChange={(e) => setModelToPull(e.target.value)}
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded outline-none text-sm"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && modelToPull.trim()) {
                                            e.preventDefault()
                                            setShowPullDialog(true)
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (modelToPull.trim()) {
                                            setShowPullDialog(true)
                                        }
                                    }}
                                    disabled={!modelToPull.trim()}
                                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-blue-300 text-sm whitespace-nowrap"
                                >
                                    Pull Model
                                </button>
                            </div>
                            <div className="mt-2 text-xs text-gray-500">
                                Browse available models at{' '}
                                <a
                                    href="https://ollama.com/library"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-500 hover:underline font-medium"
                                >
                                    ollama.com/library
                                </a>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Model
                        </label>
                        <input
                            type="text"
                            list={`models-${formData.type}`}
                            value={formData.model}
                            onChange={(e) =>
                                setFormData({ ...formData, model: e.target.value })
                            }
                            placeholder={
                                modelOptions[formData.type].length > 0
                                    ? 'Select or type a model name'
                                    : 'Type a model name'
                            }
                            className={`w-full px-3 py-2 border rounded outline-none ${
                                errors.model ? 'border-red-500' : 'border-gray-300'
                            }`}
                        />
                        <datalist id={`models-${formData.type}`}>
                            {modelOptions[formData.type].map((model) => (
                                <option key={model} value={model} />
                            ))}
                        </datalist>
                        {errors.model && (
                            <p className="text-sm text-red-600 mt-1">{errors.model}</p>
                        )}
                    </div>
                )}
        
                <div className="flex gap-2 pt-2">
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-blue-300"
                    >
                        {isLoading
                            ? (isEditMode ? 'Saving...' : 'Adding...')
                            : (isEditMode ? 'Save Changes' : 'Add Provider')
                        }
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isLoading}
                        className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:bg-gray-100"
                    >
                        Cancel
                    </button>
                </div>
            </form>

            {/* Pull Model Dialog */}
            {showDeleteDialog && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold mb-4">Delete Ollama model</h3>

                        <div className="mb-4">
                            <p className="text-sm text-gray-700">
                                Remove <span className="font-semibold">{modelToDelete}</span> from your machine?
                                This frees disk space and cannot be undone from here (you can pull it again later).
                            </p>
                            {deleteError && (
                                <p className="text-sm text-red-600 mt-3">{deleteError}</p>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={confirmDeleteModel}
                                disabled={isDeleting}
                                className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-red-300"
                            >
                                {isDeleting ? 'Deleting…' : 'Delete model'}
                            </button>
                            <button
                                type="button"
                                onClick={handleCancelDelete}
                                disabled={isDeleting}
                                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:bg-gray-100"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showPullDialog && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold mb-4">Download Ollama Model</h3>

                        <div className="mb-4">
                            <p className="text-sm text-gray-700 mb-2">
                                Model: <span className="font-semibold">{modelToPull}</span>
                            </p>
                            <p className="text-sm text-gray-500 mt-3">
                                This will download the model to your local machine.
                                The download may take several minutes depending on your internet speed and the model size.
                            </p>
                            <p className="text-xs text-gray-400 mt-2">
                                Tip: Check the model size at{' '}
                                <a
                                    href={`https://ollama.com/library/${modelToPull.split(':')[0]}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-500 hover:underline"
                                >
                                    ollama.com/library/{modelToPull.split(':')[0]}
                                </a>
                            </p>
                        </div>

                        {isPulling && (
                            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
                                <p className="text-sm text-blue-700">{pullProgress}</p>
                                <div className="mt-2 w-full bg-blue-200 rounded-full h-2">
                                    <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{ width: '100%' }}></div>
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2">
                            <button
                                onClick={confirmPullModel}
                                disabled={isPulling}
                                className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-blue-300"
                            >
                                {isPulling ? 'Downloading...' : 'Download'}
                            </button>
                            <button
                                onClick={() => {
                                    handleCancelPull()
                                }}
                                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                            >
                                {isPulling ? 'Cancel Download' : 'Cancel'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default AddProviderForm
