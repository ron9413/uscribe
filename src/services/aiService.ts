import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { AIProvider, RevisionAction } from '../types'
import {
    DEFAULT_AUTOCOMPLETE_MAX_TOKENS,
    DEFAULT_AUTOCOMPLETE_TEMPERATURE,
    getAutocompleteTemplateForModel,
} from './autocompleteTemplates/template'
import {
    DEFAULT_REVISION_MAX_TOKENS,
    DEFAULT_REVISION_TEMPERATURE,
    getRevisionTemplateForModel,
} from './revisionTemplates/template'

interface AutocompleteOptions {
  prefix: string
  suffix?: string
  maxTokens?: number
  temperature?: number
}

interface RevisionOptions {
  prefix?: string
  suffix?: string
}

interface StreamTextRequestOptions {
    requestIdPrefix: string
    logLabel: string
    errorLabel: string
    systemPrompt: string
    userPrompt: string
    maxTokens?: number
    temperature?: number
    stopSequences?: string[]
    abortSignal?: AbortSignal
}


class AIService {
    private providers: Map<string, AIProvider> = new Map()
    private clients: Map<string, any> = new Map()
    private abortControllers: Map<string, AbortController> = new Map()

    private getProviderAndClient(providerName: string) {
        const provider = this.providers.get(providerName)
        const client = this.clients.get(providerName)

        if (!provider || !client) {
            throw new Error(`Provider ${providerName} not initialized`)
        }

        return { provider, client }
    }

    private createRequestController(requestId: string) {
        const abortController = new AbortController()
        this.abortControllers.set(requestId, abortController)
        return abortController
    }

    private cleanupRequestController(requestId: string) {
        this.abortControllers.delete(requestId)
    }

    private async *streamClaudeText(
        client: any,
        request: any,
        abortController: AbortController
    ): AsyncGenerator<string> {
        const stream = await client.messages.create({
            ...request,
            stream: true,
        })

        for await (const event of stream) {
            if (abortController.signal.aborted) break

            if (event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta') {
                yield event.delta.text
            }
        }
    }

    private async *streamOpenAICompatibleText(
        client: any,
        requestBody: any,
        abortController: AbortController
    ): AsyncGenerator<string> {
        const stream = await client.chat.completions.create(
            { ...requestBody, stream: true },
            { signal: abortController.signal }
        )

        for await (const chunk of stream) {
            if (abortController.signal.aborted) break

            const content = chunk.choices[0]?.delta?.content
            if (content) {
                yield content
            }
        }
    }

    private applyProviderSpecificRequestOptions(
        provider: AIProvider,
        requestBody: any,
    ) {
        if (provider.type === 'litellm') {
            requestBody.drop_params = true
            return
        }
        if (provider.type === 'ollama') {
            // Force-disable reasoning/thinking mode for all Ollama models.
            requestBody.think = false
            requestBody.reason_effort = 'none'
            return
        }
    }

    private async *streamTextRequest(
        providerName: string,
        options: StreamTextRequestOptions
    ): AsyncGenerator<string> {
        const { provider, client } = this.getProviderAndClient(providerName)

        console.log(`Streaming ${options.logLabel} with provider: ${providerName} (${provider.type})`)
        console.log(`Model: ${provider.model}`)

        const requestId = `${providerName}-${options.requestIdPrefix}-${Date.now()}`
        const abortController = this.createRequestController(requestId)
        const externalAbortSignal = options.abortSignal
        const handleExternalAbort = () => {
            abortController.abort()
        }
        if (externalAbortSignal) {
            if (externalAbortSignal.aborted) {
                abortController.abort()
            } else {
                externalAbortSignal.addEventListener('abort', handleExternalAbort)
            }
        }
    
        try {
            if (provider.type === 'claude') {
                yield* this.streamClaudeText(client, {
                    model: provider.model,
                    max_tokens: options.maxTokens,
                    temperature: options.temperature,
                    stop_sequences: options.stopSequences,
                    system: options.systemPrompt,
                    messages: [{
                        role: 'user',
                        content: options.userPrompt
                    }],
                }, abortController)
            } else {
                const requestBody: any = {
                    model: provider.model,
                    messages: [{
                        role: 'system',
                        content: options.systemPrompt,
                    }, {
                        role: 'user',
                        content: options.userPrompt,
                    }],
                    max_tokens: options.maxTokens,
                    temperature: options.temperature,
                }

                if (options.stopSequences && options.stopSequences.length > 0) {
                    requestBody.stop = options.stopSequences
                }

                this.applyProviderSpecificRequestOptions(provider, requestBody)
                yield* this.streamOpenAICompatibleText(client, requestBody, abortController)
            }
        } catch (error) {
            console.error(`Error in ${options.errorLabel}:`, error)
            throw error
        } finally {
            if (externalAbortSignal) {
                externalAbortSignal.removeEventListener('abort', handleExternalAbort)
            }
            this.cleanupRequestController(requestId)
        }
    }

    async initializeProvider(provider: AIProvider, apiKey: string) {
        this.providers.set(provider.name, provider)

        try {
            switch (provider.type) {
                case 'openai':
                    this.clients.set(provider.name, new OpenAI({
                        apiKey,
                        dangerouslyAllowBrowser: true // Only for Electron app
                    }))
                    break

                case 'azure':
                    this.clients.set(provider.name, new OpenAI({
                        apiKey,
                        baseURL: provider.baseUrl,
                        dangerouslyAllowBrowser: true
                    }))
                    break

                case 'claude':
                    this.clients.set(provider.name, new Anthropic({
                        apiKey,
                    }))
                    break

                case 'ollama': {
                    // Use 127.0.0.1 instead of localhost so Node (e.g. main process) connects via IPv4.
                    // Otherwise localhost can resolve to ::1 and Ollama may only listen on 127.0.0.1.
                    const ollamaBase = provider.baseUrl || 'http://127.0.0.1:11434/v1'
                    const baseURL = ollamaBase.replace(/localhost/i, '127.0.0.1')
                    this.clients.set(provider.name, new OpenAI({
                        apiKey: 'ollama', // Ollama doesn't need a real key
                        baseURL,
                        dangerouslyAllowBrowser: true
                    }))
                    break
                }

                case 'litellm':
                    this.clients.set(provider.name, new OpenAI({
                        apiKey,
                        baseURL: provider.baseUrl || 'http://localhost:4000',
                        dangerouslyAllowBrowser: true
                    }))
                    break

                default:
                    throw new Error(`Unsupported provider type: ${provider.type}`)
            }
        } catch (error) {
            console.error(`Failed to initialize provider ${provider.name}:`, error)
            throw error
        }
    }

    cancelCompletion(requestId: string) {
        const controller = this.abortControllers.get(requestId)
        if (controller) {
            controller.abort()
            this.abortControllers.delete(requestId)
        }
    }

    cancelAllCompletions() {
        this.abortControllers.forEach(controller => controller.abort())
        this.abortControllers.clear()
    }

    async *streamAutocomplete(
        providerName: string,
        options: AutocompleteOptions
    ): AsyncGenerator<string> {
        const { provider } = this.getProviderAndClient(providerName)

        // Get the appropriate template for this model
        const template = getAutocompleteTemplateForModel(provider.model)
        const templateOptions = template.completionOptions || {}

        const prompt = template.buildPrompts(options.prefix, options.suffix || '')

        console.log('Autocomplete user prompt preview:', prompt.userPrompt)

        // Merge options with template-specific options        
        const maxTokens = options.maxTokens ?? templateOptions.maxTokens ?? DEFAULT_AUTOCOMPLETE_MAX_TOKENS
        const temperature = options.temperature !== undefined
            ? options.temperature
            : (templateOptions.temperature ?? DEFAULT_AUTOCOMPLETE_TEMPERATURE)
        const stopSequences = templateOptions.stop || []

        yield* this.streamTextRequest(providerName, {
            requestIdPrefix: 'autocomplete',
            logLabel: 'autocomplete',
            errorLabel: 'streamAutocomplete',
            systemPrompt: prompt.systemPrompt,
            userPrompt: prompt.userPrompt,
            maxTokens: maxTokens,
            temperature: temperature,
            stopSequences: stopSequences,
        })
    }

    /**
     * Streams revision output chunks; callers can either render progressively
     * or aggregate chunks for background operations.
     */
    async *streamRevision(
        providerName: string,
        text: string,
        action: RevisionAction,
        customPrompt?: string,
        options: RevisionOptions = {},
        abortSignal?: AbortSignal
    ): AsyncGenerator<string> {
        const { provider } = this.getProviderAndClient(providerName)

        console.log(`Streaming revision with action: ${action}`)

        // Get the appropriate template for this model
        const template = getRevisionTemplateForModel(provider.model)
        const { revisionOptions } = template
        const prompt = template.buildPrompts(
            text,
            action,
            customPrompt,
            options.prefix || '',
            options.suffix || '',
        )

        console.log('Revision user prompt preview:', prompt.userPrompt.substring(0, 200) + '...')

        const temperature = revisionOptions?.temperature ?? DEFAULT_REVISION_TEMPERATURE
        const maxTokens = revisionOptions?.maxTokens ?? DEFAULT_REVISION_MAX_TOKENS

        yield* this.streamTextRequest(providerName, {
            requestIdPrefix: 'revision',
            logLabel: 'revision',
            errorLabel: 'streamRevision',
            systemPrompt: prompt.systemPrompt,
            userPrompt: prompt.userPrompt,
            maxTokens: maxTokens,
            temperature: temperature,
            abortSignal,
        })
    }

    async reviseText(
        providerName: string,
        text: string,
        action: RevisionAction,
        customPrompt?: string,
        options: RevisionOptions = {}
    ): Promise<string> {
        let revisedText = ''

        for await (const chunk of this.streamRevision(
            providerName,
            text,
            action,
            customPrompt,
            options
        )) {
            revisedText += chunk
        }

        const finalText = revisedText || text
        console.log('Revision completed:', finalText.substring(0, 100) + '...')
        return finalText
    }

    getProvider(name: string): AIProvider | undefined {
        return this.providers.get(name)
    }

    hasProvider(name: string): boolean {
        return this.providers.has(name)
    }
}

export const aiService = new AIService()
