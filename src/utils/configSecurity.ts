import { AIConfig, AIProvider } from '../types'

const SENSITIVE_PROVIDER_FIELDS = ['apiKey', 'apikey', 'token', 'accessToken', 'secret'] as const

function hasNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
}

function providerHasSensitiveFields(provider: AIProvider): boolean {
    const providerRecord = provider as unknown as Record<string, unknown>
    return SENSITIVE_PROVIDER_FIELDS.some((field) => hasNonEmptyString(providerRecord[field]))
}

export function configContainsPlaintextApiKeys(config: AIConfig): boolean {
    return config.providers.some(providerHasSensitiveFields)
}

export function sanitizeProviderForStorage(provider: AIProvider): AIProvider {
    const sanitizedProvider: AIProvider = {
        name: provider.name,
        type: provider.type,
        model: provider.model,
    }

    if (provider.baseUrl) {
        sanitizedProvider.baseUrl = provider.baseUrl
    }

    return sanitizedProvider
}

export function sanitizeConfigForStorage(config: AIConfig): AIConfig {
    return {
        ...config,
        providers: config.providers.map(sanitizeProviderForStorage),
    }
}
