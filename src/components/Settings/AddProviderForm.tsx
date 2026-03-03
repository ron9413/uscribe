import { useState, useEffect } from 'react'
import { AIProvider } from '../../types'

interface AddProviderFormProps {
    onAdd: (provider: AIProvider, apikey: string) => void
    onCancel: () => void
    isLoading: boolean
    editingProvider?: AIProvider
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

function AddProviderForm({onAdd, onCancel, isLoading, editingProvider }: AddProviderFormProps) {
    const [formData, setFormData] = useState({
        name: editingProvider?.name || '',
        type: editingProvider?.type || ('openai' as AIProvider['type']),
        apiKey: '',
        baseUrl: editingProvider?.baseUrl || '',
        model: editingProvider?.model || '',
    })

    const [errors, setErrors] = useState<Record<string, string>>({})
    const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
    const [loadingOllamaModels, setLoadingOllamaModels] = useState(false)
    const [showPullDialog, setShowPullDialog] = useState(false)
    const [modelToPull, setModelToPull] = useState('')
    const [pullProgress, setPullProgress] = useState('')
    const [isPulling, setIsPulling] = useState(false)

    const modelOptions: Record<AIProvider['type'], string[]> = {
        openai: ['gpt-4', 'gpt-4-turbo-preview', 'gpt-3.5-turbo'],
        azure: ['gpt-4', 'gpt-3.5-turbo'],
        claude: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
        ollama: [],
        litellm: ['gpt-4', 'gpt-3.5-turbo', 'claude-3-sonnet-20240229', 'gemini-pro'],
    }

    // Fetch Ollama models when type is ollama
    useEffect(() => {
        if (formData.type === 'ollama') {
            fetchOllamaModels()
        }
    }, [formData.type])

    const fetchOllamaModels = async () => {
        setLoadingOllamaModels(true)
        try {
            const response = await fetch('http://localhost:11434/api/tags')

            if (!response.ok) {
                throw new Error('Failed to fetch Ollama models. Is Ollama running?')
            }

            const data = await response.json()
            setOllamaModels(data.models || [])
            setErrors({ ...errors, ollama: '' })
        } catch (error: any) {
            console.error('Error fetching Ollama models:', error)
            setErrors({ ...errors, ollama: error.message })
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
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    const confirmPullModel = async () => {
        setIsPulling(true)
        setPullProgress('Starting download...')

        try {
            const response = await fetch('http://localhost:11434/api/pull', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: modelToPull, stream: true })
            })

            if (!response.ok) {
                throw new Error('Failed to pull model')
            }

            const reader = response.body?.getReader()
            const decoder = new TextDecoder()

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    const text = decoder.decode(value)
                    const lines = text.split('\n').filter(line => line.trim())

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
            }

            setPullProgress('Download complete!')
            await fetchOllamaModels() // Refresh model list

            // Auto-select the pulled model
            setFormData({ ...formData, model: modelToPull })

            setTimeout(() => {
                setShowPullDialog(false)
                setIsPulling(false)
                setPullProgress('')
            }, 1500)
        } catch (error: any) {
            console.error('Error pulling model:', error)
            setPullProgress(`Error: ${error.message}`)
            setIsPulling(false)
        }
    }

    const validate = () => {
        const newErrors: Record<string, string> = {}

        if (!formData.name.trim()) {
            newErrors.name = 'Name is required'
        }

        // API key is required only when adding a new provider (not editing) or when type is not ollama
        if (formData.type !== 'ollama' && !formData.apiKey.trim() && !isEditMode) {
            newErrors.apiKey = 'API key is required'
        }

        if (!formData.model.trim()) {
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

        onAdd(provider, formData.apiKey)
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
                                <span className="text-sm text-gray-500 ml-2">
                                    (leave empty to keep existing)
                                </span>
                            )}
                        </label>
                        <input
                            type="password"
                            value={formData.apiKey}
                            onChange={(e) =>
                                setFormData({ ...formData, apiKey: e.target.value })
                            }
                            placeholder={isEditMode ? "Leave empty to keep existing key" : "sk-..."}
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
                                {ollamaModels.map((model) => (
                                    <label
                                        key={model.name}
                                        className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer"
                                    >
                                        <input
                                            type="radio"
                                            name="ollamaModel"
                                            value={model.name}
                                            checked={formData.model === model.name}
                                            onChange={(e) =>
                                                setFormData({ ...formData, model: e.target.value })
                                            }
                                            className="mr-3"
                                        />
                                        <div className="flex-1">
                                            <div className="text-sm font-medium">{model.name}</div>
                                            <div className="text-xs text-gray-500">
                                                {formatBytes(model.size)}
                                                {model.details?.parameter_size && ` • ${model.details.parameter_size}`}
                                                {model.details?.quantization_level && ` • ${model.details.quantization_level}`}
                                            </div>
                                        </div>
                                    </label>
                                ))}
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
                                    onKeyPress={(e) => {
                                        if (e.key === 'Enter' && modelToPull.trim()) {
                                            e.preventDefault();
                                            setShowPullDialog(true);
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (modelToPull.trim()) {
                                            setShowPullDialog(true);
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
                                    Ollama.com/library
                                </a>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div>
                        <label className="block text-sm font-medium mb-1">
                            Model
                            <span className="text-xs text-gray-500 ml-2"> (select or type custom) </span>
                        </label>
                        <input
                            type="text"
                            list={`models-${formData.type}`}
                            value={formData.model}
                            onChange={(e) =>
                                setFormData({ ...formData, model: e.target.value })
                            }
                            placeholder="Select or type a model name"
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
                            <p className="text-sm text-gray-400 mt-2">
                                Tip: Check the model size at{' '}
                                <a
                                    href={`https://ollama.com/library/${modelToPull.split(':')[0]}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-500 hover:underline"
                                >
                                    Ollama.com/library/{modelToPull.split(':')[0]}
                                </a>
                            </p>
                        </div>

                        {isPulling && (
                            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded">
                                <p className="text-sm text-blue-700">{pullProgress}</p>
                                <div className="mt-2 w-full bg-blue-200 rounded-full h-2">
                                    <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{ width: `100%` }}></div>
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
                                    setShowPullDialog(false)
                                    setModelToPull('')
                                    setPullProgress('')
                                }}
                                disabled={isPulling}
                                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:bg-gray-100"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default AddProviderForm
