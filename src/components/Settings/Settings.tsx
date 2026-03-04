import { useState, useEffect } from 'react'
import { AIConfig, AIProvider, CustomRevisionShortcut } from '../../types'
import { aiService } from '../../services/aiService'
import { getStorage } from '../../services/browserStorage'
import ProviderItem from './ProviderItem'
import AddProviderForm from './AddProviderForm'
import { parseShortcutInput, acceleratorToDisplay } from '../../utils/shortcutUtils'

interface SettingsProps {
    config: AIConfig
    onSave: (config: AIConfig) => void | Promise<void>
    onClose: () => void
}

interface CustomShortcutDraft {
    name: string
    prompt: string
    shortcut: string
    scope: 'global' | 'local'
}

function getShortcutScope(scope?: 'global' | 'local'): 'global' | 'local' {
    return scope === 'global' ? 'global' : 'local'
}

// Helper function to get default API key for providers that don't require authentication
function getDefaultApiKey(provider: AIProvider): string | null {
    switch (provider.type) {
        case 'ollama':
            return 'ollama' // Ollama doesn't require authentication
        // Add more provider types here that don't require real API keys
        default:
            return null
    }
}

function Settings({ config, onSave, onClose }: SettingsProps) {
    const [localConfig, setLocalConfig] = useState<AIConfig>({
        ...config,
        customRevisionShortcuts: config.customRevisionShortcuts.map(shortcut => ({
            ...shortcut,
            scope: getShortcutScope(shortcut.scope),
        })),
    })
    const [showAddForm, setShowAddForm] = useState(false)
    const [editingProvider, setEditingProvider] = useState<AIProvider | undefined>(undefined)
    const [initializingProvider, setInitializingProvider] = useState<string>('')
    const [newShortcut, setNewShortcut] = useState<CustomShortcutDraft>({
        name: '',
        prompt: '',
        shortcut: '',
        scope: 'local',
    })
    const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null)
    const [showShortcutForm, setShowShortcutForm] = useState(false)
    const [shortcutError, setShortcutError] = useState('')

    const normalizeConfig = (nextConfig: AIConfig): AIConfig => ({
        ...nextConfig,
        autoCompleteDelay: 250,
        customRevisionShortcuts: nextConfig.customRevisionShortcuts.map(shortcut => ({
            ...shortcut,
            scope: getShortcutScope(shortcut.scope),
        })),
    })

    const persistConfig = (nextConfig: AIConfig) => {
        const normalizedConfig = normalizeConfig(nextConfig)
        setLocalConfig(normalizedConfig)
        void onSave(normalizedConfig)
    }

    // Initialize providers on mount
    useEffect(() => {
        const initProviders = async () => {
            const storage = getStorage()
            for (const provider of localConfig.providers) {
                if (!aiService.hasProvider(provider.name)) {
                    try {
                        let apiKey = await storage.getApiKey(provider.name)

                        // Use default key for providers that don't require authentication
                        if (!apiKey) {
                            apiKey = getDefaultApiKey(provider)
                        }

                        if (apiKey) {
                            await aiService.initializeProvider(provider, apiKey)
                        }
                    } catch (error) {
                        console.error(`Failed to initialize provider ${provider.name}:`, error)
                    }
                }
            }
        }
        initProviders()
    }, [localConfig.providers])

    const handleAddProvider = async (provider: AIProvider, apiKey: string) => {
        try {
            setInitializingProvider(provider.name)

            const storage = getStorage()

            // Handle API key
            if (editingProvider) {
                // When editing
                if (apiKey) {
                    // New API key provided, store it
                    await storage.storeApiKey(provider.name, apiKey)
                } else {
                    // No new API key provided, use the existing one
                    const existingApiKey = await storage.getApiKey(editingProvider.name)
                    if (existingApiKey) {
                        apiKey = existingApiKey
                        // If provider name changed, store the key under the new name
                        if (provider.name !== editingProvider.name) {
                            await storage.storeApiKey(provider.name, apiKey)
                        }
                    }
                }
            } else {
                // When adding new provider, API key must be provided
                await storage.storeApiKey(provider.name, apiKey)
            }

            // Initialize the provider
            await aiService.initializeProvider(provider, apiKey)

            let newProviders: AIProvider[]
            let newActiveProvider = localConfig.activeProvider

            if (editingProvider) {
                // Update existing provider
                newProviders = localConfig.providers.map(p =>
                    p.name === editingProvider.name ? provider : p
                )
                // Update active provider name if it was the edited one and name changed
                if (localConfig.activeProvider === editingProvider.name && provider.name !== editingProvider.name) {
                    newActiveProvider = provider.name
                }
            } else {
                // Add new provider
                newProviders = [...localConfig.providers, provider]
                newActiveProvider = localConfig.activeProvider || provider.name
            }
        
            persistConfig({
                ...localConfig,
                providers: newProviders,
                activeProvider: newActiveProvider,
            })

            setShowAddForm(false)
            setEditingProvider(undefined)
        } catch (error) {
            console.error('Error adding/updating provider:', error)
            alert('Failed to add/update provider. Please check your API key and try again.')
        } finally {
            setInitializingProvider('')
        }
    }

    const handleEditProvider = (provider: AIProvider) => {
        setEditingProvider(provider)
        setShowAddForm(true)
    }

    const handleRemoveProvider = (name: string) => {
        const newProviders = localConfig.providers.filter((p) => p.name !== name)
        const newConfig = {
            ...localConfig,
            providers: newProviders,
            activeProvider:
                localConfig.activeProvider === name
                    ? newProviders[0]?.name || ''
                    : localConfig.activeProvider,
        }
        persistConfig(newConfig)
    }

    const handleSetActive = (name: string) => {
        persistConfig({
            ...localConfig,
            activeProvider: name,
        })
    }

    const handleToggleAutoComplete = () => {
        persistConfig({
            ...localConfig,
            autoCompleteEnabled: !localConfig.autoCompleteEnabled,
        })
    }

    const handleAddCustomShortcut = () => {
        setShortcutError('')

        if (!newShortcut.prompt.trim()) {
            setShortcutError('Prompt is required.')
            return
        }

        const parsed = parseShortcutInput(newShortcut.shortcut)
        if (parsed.error) {
            setShortcutError(parsed.error)
            return
        }

        if (
            parsed.accelerator === 'CommandOrControl+Shift+1' ||
            parsed.accelerator === 'CommandOrControl+Shift+2'
        ) {
            setShortcutError('This shortcut is reserved by built-in actions.')
            return
        }

        if (
            localConfig.customRevisionShortcuts.some(
                shortcut =>
                    shortcut.accelerator === parsed.accelerator &&
                    shortcut.id !== editingShortcutId,
            )
        ) {
            setShortcutError('This shortcut is already in use.')
            return
        }

        const shortcut: CustomRevisionShortcut = {
            id: editingShortcutId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: newShortcut.name.trim() || 'Custom Shortcut',
            prompt: newShortcut.prompt.trim(),
            accelerator: parsed.accelerator,
            scope: newShortcut.scope,
        }

        persistConfig({
            ...localConfig,
            customRevisionShortcuts: editingShortcutId
                ? localConfig.customRevisionShortcuts.map(item =>
                      item.id === editingShortcutId ? shortcut : item,
                  )
                : [...localConfig.customRevisionShortcuts, shortcut],
        })
        setNewShortcut({ name: '', prompt: '', shortcut: '', scope: 'local' })
        setEditingShortcutId(null)
        setShowShortcutForm(false)
    }

    const handleRemoveCustomShortcut = (id: string) => {
        persistConfig({
            ...localConfig,
            customRevisionShortcuts: localConfig.customRevisionShortcuts.filter(
                shortcut => shortcut.id !== id,
            ),
        })

        if (editingShortcutId === id) {
            setEditingShortcutId(null)
            setNewShortcut({ name: '', prompt: '', shortcut: '', scope: 'local' })
            setShortcutError('')
        }
    }

    const handleEditCustomShortcut = (shortcut: CustomRevisionShortcut) => {
        setEditingShortcutId(shortcut.id)
        setShowShortcutForm(true)
        setShortcutError('')
        setNewShortcut({
            name: shortcut.name,
            prompt: shortcut.prompt,
            shortcut: shortcut.accelerator,
            scope: getShortcutScope(shortcut.scope),
        })
    }

    const handleCancelEditShortcut = () => {
        setEditingShortcutId(null)
        setShowShortcutForm(false)
        setShortcutError('')
        setNewShortcut({ name: '', prompt: '', shortcut: '', scope: 'local' })
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                    <h2 className="text-2xl font-semibold">Settings</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded"
                    >
                        <svg
                            className="w-6 h-6"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-6">
                    {/* AI Providers Section */}
                    <section className="mb-8">
                        <h3 className="text-lg font-semibold mb-4">AI Providers</h3>

                        {localConfig.providers.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                <p className="mb-4">No AI providers configured</p>
                                <button
                                    onClick={() => setShowAddForm(true)}
                                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                >
                                    Add Provider
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className="space-y-3 mb-4">
                                    {localConfig.providers.map((provider) => (
                                        <div key={provider.name}>
                                            <ProviderItem
                                                provider={provider}
                                                isActive={provider.name === localConfig.activeProvider}
                                                isEditing={editingProvider?.name === provider.name}
                                                onSetActive={handleSetActive}
                                                onRemove={handleRemoveProvider}
                                                onEdit={handleEditProvider}
                                            />
                                            {editingProvider?.name === provider.name && (
                                                <AddProviderForm
                                                    onAdd={handleAddProvider}
                                                    onCancel={() => {
                                                        setShowAddForm(false)
                                                        setEditingProvider(undefined)
                                                    }}
                                                    isLoading={!!initializingProvider}
                                                    editingProvider={editingProvider}
                                                />
                                            )}
                                        </div>
                                    ))}
                                </div>
                                {!editingProvider && !showAddForm && (
                                    <button
                                        onClick={() => setShowAddForm(true)}
                                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                                    >
                                        + Add Another Provider
                                    </button>
                                )}
                            </>
                        )}

                        {showAddForm && !editingProvider && (
                            <AddProviderForm
                                onAdd={handleAddProvider}
                                onCancel={() => {
                                    setShowAddForm(false)
                                    setEditingProvider(undefined)
                                }}
                                isLoading={!!initializingProvider}
                                editingProvider={editingProvider}
                            />
                        )}
                    </section>

                    {/* Auto-Complete Settings */}
                    <section className="mb-8">
                        <h3 className="text-lg font-semibold mb-4">Auto-Complete</h3>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium">
                                    Enable Auto-Complete
                                </label>
                                <button
                                    onClick={handleToggleAutoComplete}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        localConfig.autoCompleteEnabled
                                            ? 'bg-blue-500'
                                            : 'bg-gray-300'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                            localConfig.autoCompleteEnabled
                                                ? 'translate-x-6'
                                                : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>

                        </div>
                    </section>

                    {/* Keyboard Shortcuts */}
                    <section>
                        <h3 className="text-lg font-semibold mb-4">Keyboard Shortcuts</h3>
                        <div className="mb-2 mt-1">
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                Default Shortcuts
                            </span>
                        </div>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between py-2 border-b border-gray-200 gap-4">
                                <div className="flex items-center gap-2">
                                    <span>Auto-complete (Accept)</span>
                                    <span className="px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-700 border border-gray-300">
                                        Local
                                    </span>
                                </div>
                                <kbd className="px-2 py-1 bg-gray-100 rounded border border-gray-300">
                                    Tab
                                </kbd>
                            </div>
                            <div className="flex justify-between py-2 border-b border-gray-200 gap-4">
                                <div className="flex items-center gap-2">
                                    <span>Auto-complete (Dismiss)</span>
                                    <span className="px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-700 border border-gray-300">
                                        Local
                                    </span>
                                </div>
                                <kbd className="px-2 py-1 bg-gray-100 rounded border border-gray-300">
                                    Esc
                                </kbd>
                            </div>
                            <div className="flex justify-between py-2 border-b border-gray-200 gap-4">
                                <div className="flex items-center gap-2">
                                    <span>Toggle Auto-complete</span>
                                    <span className="px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-700 border border-gray-300">
                                        Local
                                    </span>
                                </div>
                                <kbd className="px-2 py-1 bg-gray-100 rounded border border-gray-300">
                                    ⇧Tab
                                </kbd>
                            </div>
                            <div className="flex justify-between py-2 border-b border-gray-200 gap-4">
                                <div className="flex items-center gap-2">
                                    <span>Revise Text</span>
                                    <span className="px-2 py-0.5 text-[11px] rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                        Global
                                    </span>
                                </div>
                                <kbd className="px-2 py-1 bg-gray-100 rounded border border-gray-300">
                                    ⌘⇧1
                                </kbd>
                            </div>
                            <div className="flex justify-between py-2 border-b border-gray-200 gap-4">
                                <div className="flex items-center gap-2">
                                    <span>Quick Edit</span>
                                    <span className="px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-700 border border-gray-300">
                                        Global
                                    </span>
                                </div>
                                <kbd className="px-2 py-1 bg-gray-100 rounded border border-gray-300">
                                    ⌘⇧2
                                </kbd>
                            </div>
                        </div>

                        <div className="mb-2 mt-6">
                            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                Custom Shortcuts
                            </span>
                        </div>
                        <div className="space-y-2 text-sm">
                            {localConfig.customRevisionShortcuts.length === 0 && (
                                <p className="text-xs text-gray-500">No custom shortcuts yet.</p>
                            )}
                            {localConfig.customRevisionShortcuts.map(shortcut => (
                                <div
                                    key={shortcut.id}
                                    className="py-2 border-b border-gray-200 flex items-center justify-between gap-4"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-medium text-gray-800">{shortcut.name}</p>
                                            <span
                                                className={`px-2 py-0.5 text-[11px] rounded-full border ${
                                                    getShortcutScope(shortcut.scope) === 'global'
                                                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                        : 'bg-gray-100 text-gray-700 border-gray-300'
                                                }`}
                                            >
                                                {getShortcutScope(shortcut.scope) === 'global' ? 'Global' : 'Local'}
                                            </span>
                                            <button
                                                type="button"
                                                className="text-xs text-blue-600 hover:text-blue-700"
                                                onClick={() => handleEditCustomShortcut(shortcut)}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                type="button"
                                                className="text-xs text-red-600 hover:text-red-700"
                                                onClick={() => handleRemoveCustomShortcut(shortcut.id)}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-500 truncate">{shortcut.prompt}</p>
                                    </div>
                                    <div className="shrink-0">
                                        <kbd className="px-2 py-1 bg-gray-100 rounded border border-gray-300">
                                            {acceleratorToDisplay(shortcut.accelerator)}
                                        </kbd>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {!showShortcutForm ? (
                            <button
                                type="button"
                                className="mt-4 px-3 py-2 bg-gray-900 text-white rounded text-sm hover:bg-black"
                                onClick={() => {
                                    setEditingShortcutId(null)
                                    setShortcutError('')
                                    setNewShortcut({ name: '', prompt: '', shortcut: '', scope: 'local' })
                                    setShowShortcutForm(true)
                                }}
                            >
                                Add Custom Shortcut
                            </button>
                        ) : (
                            <div className="mt-4 p-4 border border-gray-200 rounded-lg space-y-3">
                                <h4 className="font-medium text-sm">
                                    {editingShortcutId ? 'Edit Custom Shortcut' : 'Add Custom Shortcut'}
                                </h4>
                                <div className="grid grid-cols-1 gap-3">
                                    <input
                                        type="text"
                                        value={newShortcut.name}
                                        onChange={(event) =>
                                            setNewShortcut({ ...newShortcut, name: event.target.value })
                                        }
                                        placeholder="Label (e.g. Make concise)"
                                        className="px-3 py-2 border border-gray-300 rounded text-sm"
                                    />
                                    <input
                                        type="text"
                                        value={newShortcut.prompt}
                                        onChange={(event) =>
                                            setNewShortcut({ ...newShortcut, prompt: event.target.value })
                                        }
                                        placeholder="Prompt (e.g. Rewrite in a concise tone)"
                                        className="px-3 py-2 border border-gray-300 rounded text-sm"
                                    />
                                    <input
                                        type="text"
                                        value={newShortcut.shortcut}
                                        onChange={(event) =>
                                            setNewShortcut({ ...newShortcut, shortcut: event.target.value })
                                        }
                                        placeholder="Shortcut (e.g. Cmd+Shift+3)"
                                        className="px-3 py-2 border border-gray-300 rounded text-sm"
                                    />
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <label className="text-xs font-medium text-gray-600">Scope</label>
                                        <select
                                            value={newShortcut.scope}
                                            onChange={(event) =>
                                                setNewShortcut({
                                                    ...newShortcut,
                                                    scope: event.target.value as 'global' | 'local',
                                                })
                                            }
                                            className="px-3 py-2 border border-gray-300 rounded text-sm bg-white"
                                        >
                                            <option value="local">Local (editor only)</option>
                                            <option value="global">Global (system-wide)</option>
                                        </select>
                                        {newShortcut.scope === 'global' && (
                                            <span className="text-xs text-amber-700">
                                                Global shortcuts can collide with system shortcuts. Use with caution.
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <p className="text-xs text-gray-500">
                                    Format: Cmd/Ctrl + optional Shift/Alt + key (letter/number/F-key)
                                </p>
                                {shortcutError && <p className="text-xs text-red-600">{shortcutError}</p>}
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        className="px-3 py-2 bg-gray-900 text-white rounded text-sm hover:bg-black"
                                        onClick={handleAddCustomShortcut}
                                    >
                                        {editingShortcutId ? 'Save Shortcut' : 'Add Shortcut'}
                                    </button>
                                    <button
                                        type="button"
                                        className="px-3 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
                                        onClick={handleCancelEditShortcut}
                                    >
                                        {editingShortcutId ? 'Cancel Edit' : 'Cancel'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                </div>

            </div>
        </div>
    )
}

export default Settings
