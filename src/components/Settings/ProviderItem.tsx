import { AIProvider } from '../../types'

interface ProviderItemProps {
    provider: AIProvider
    isActive: boolean
    isEditing: boolean
    onSetActive: (name: string) => void
    onRemove: (name: string) => void
    onEdit: (provider: AIProvider) => void
}

function ProviderItem({
    provider,
    isActive,
    isEditing,
    onSetActive,
    onRemove,
    onEdit,
}: ProviderItemProps) {
    const getProviderIcon = (type: string) => {
        switch (type) {
            case "openai":
                return "🤖";
            case "azure":
                return "☁️";
            case "claude":
                return "🧠";
            case "ollama":
                return "🦙";
            default:
                return "⚙️";
        }
    }

    const handleRemove = () => {
        if (confirm(`Remove provider "${provider.name}"?`)) {
            onRemove(provider.name)
        }
    }

    return (
        <div
            className={`p-4 border rounded-lg transition-colors ${
                isEditing
                    ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200'
                    : isActive
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
            }`}
        >
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{getProviderIcon(provider.type)}</span>
                        <div>
                            <h4 className="font-semibold">{provider.name}</h4>
                            <p className="text-gray-600">
                                {provider.type.toUpperCase()} • {provider.model}
                            </p>
                        </div>
                    </div>
                    {provider.baseUrl && (
                        <p className="text-xs text-gray-500 mt-1">
                            Endpoint: {provider.baseUrl}
                        </p>
                    )}
                </div>

                <div className="flex gap-2">
                    {!isActive && (
                        <button
                            onClick={() => onSetActive(provider.name)}
                            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                            Set Active
                        </button>
                    )}
                    {isActive && (
                        <span className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded font-medium">
                            Active
                        </span>
                    )}
                    <button
                        onClick={() => onEdit(provider)}
                        className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                    >
                        Edit
                    </button>
                    <button
                        onClick={handleRemove}
                        className="px-3 py-1 text-sm bg-red-100 text-red-600 rounded hover:bg-red-200"
                    >
                        Remove
                    </button>
                </div>
            </div>
        </div>
    )
}

export default ProviderItem
