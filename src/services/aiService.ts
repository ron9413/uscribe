import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { AIProvider, RevisionAction } from '../types'
import { getTemplateForModel } from './autocompleteTemplates'
import { getRevisionTemplateForModel } from './revisionTemplates'

interface CompletionOptions {
  maxTokens?: number
  temperature?: number
  stopSequences?: string[]
  enableThinking?: boolean
}

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

class AIService {
    private providers: Map<string, AIProvider> = new Map()
    private clients: Map<string, any> = new Map()
    private abortControllers: Map<string, AbortController> = new Map()

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

    async *streamCompletion(
        providerName: string,
        context: string,
        options: CompletionOptions = {}
    ): AsyncGenerator<string> {
        const provider = this.providers.get(providerName)
        const client = this.clients.get(providerName)

        if (!provider || !client) {
            throw new Error(`Provider ${providerName} not initialized`)
        }

        console.log(`Streaming completion with provider: ${providerName} (${provider.type})`)

        const requestId = `${providerName}-${Date.now()}`
        const abortController = new AbortController()
        this.abortControllers.set(requestId, abortController)
    
        const prompt = `You are an AI writing assistant. Continue the text below naturally and seamlessly. Write ONLY the continuation text, no explanations or additional commentary. The continuation should flow directly from where the text ends.

${context}`

        try {
            if (provider.type === 'claude') {
                // Claude API uses messages format
                const stream = await client.messages.create({
                    model: provider.model,
                    max_tokens: options.maxTokens || 150,
                    temperature: options.temperature || 0.7,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }],
                    stream: true,
                })

                for await (const event of stream) {
                    if (abortController.signal.aborted) break

                    if (event.type === 'content_block_delta' &&
                        event.delta.type === 'text_delta') {
                        yield event.delta.text
                    }
                }
            } else {
                // OpenAI-compatible API (OpenAI, Azure, Ollama, LiteLLM)
                const requestBody: any = {
                    model: provider.model,
                    messages: [{
                        role: 'system',
                        content: prompt
                    }, {
                        role: 'user',
                        content: context
                    }],
                    max_tokens: options.maxTokens || 150,
                    temperature: options.temperature || 0.7,
                    stream: true,
                }

                // Control thinking/reasoning mode (especially for Qwen models where default is true)
                if (options.enableThinking !== undefined) {
                    requestBody.enable_thinking = options.enableThinking
                }

                const stream = await client.chat.completions.create(requestBody, {
                    signal: abortController.signal
                })

                for await (const chunk of stream) {
                    if (abortController.signal.aborted) break

                    const content = chunk.choices[0]?.delta?.content
                    if (content) {
                        yield content
                    }
                }
            }
        } catch (error) {
            console.error('Error in streamCompletion:', error)
            throw error
        } finally {
            this.abortControllers.delete(requestId)
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

    /**
     * Optimized autocomplete using standardized sentence-completion templates.
     */
    async *streamAutocomplete(
        providerName: string,
        options: AutocompleteOptions
    ): AsyncGenerator<string> {
        const provider = this.providers.get(providerName)
        const client = this.clients.get(providerName)

        if (!provider || !client) {
            throw new Error(`Provider ${providerName} not initialized`)
        }

        console.log(`Streaming autocomplete with provider: ${providerName} (${provider.type})`)
        console.log(`Model: ${provider.model}`)

        const requestId = `${providerName}-autocomplete-${Date.now()}`
        const abortController = new AbortController()
        this.abortControllers.set(requestId, abortController)

        // Get the appropriate template for this model
        const template = getTemplateForModel(provider.model)
        const templateOptions = template.completionOptions || {}

        // Build the prompt using the template
        let prompt: string
        if (typeof template.template === 'function') {
            prompt = template.template(
                options.prefix,
                options.suffix || ''
            )
        } else {
            prompt = template.template
                .replace('{{{prefix}}}', options.prefix)
                .replace('{{{suffix}}}', options.suffix || '')
        }

        console.log('Autocomplete prompt preview:', prompt)

        // Merge options with template-specific options        
        const maxTokens = options.maxTokens || templateOptions.maxTokens || 100
        const temperature = options.temperature !== undefined ? options.temperature : (templateOptions.temperature || 0.3)
        const stopSequences = templateOptions.stop || []

        try {
            if (provider.type === 'claude') {
                // Claude API uses messages format
                const stream = await client.messages.create({
                    model: provider.model,
                    max_tokens: maxTokens,
                    temperature: temperature,
                    stop_sequences: stopSequences,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }],
                    stream: true,
                })

                for await (const event of stream) {
                    if (abortController.signal.aborted) break

                    if (event.type === 'content_block_delta' &&
                        event.delta.type === 'text_delta') {
                        yield event.delta.text
                    }
                }
            } else {
                // OpenAI-compatible API (OpenAI, Azure, Ollama, LiteLLM)
                const requestBody: any = {
                    model: provider.model,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }],
                    max_tokens: maxTokens,
                    temperature: temperature,
                    stream: true,
                }

                // Add stop sequences if provided
                if (stopSequences.length > 0) {
                    requestBody.stop = stopSequences
                }

                // Disable thinking mode for autocomplete
                requestBody.enable_thinking = false

                const stream = await client.chat.completions.create(requestBody, {
                    signal: abortController.signal
                })

                for await (const chunk of stream) {
                    if (abortController.signal.aborted) break

                    const content = chunk.choices[0]?.delta?.content
                    if (content) {
                        yield content
                    }
                }
            }
        } catch (error) {
            console.error('Error in streamAutocomplete:', error)
            throw error
        } finally {
            this.abortControllers.delete(requestId)
        }
    }

    async reviseText(
        providerName: string,
        text: string,
        action: RevisionAction,
        customPrompt?: string,
        options: RevisionOptions = {}
    ): Promise<string> {
        const provider = this.providers.get(providerName)
        const client = this.clients.get(providerName)

        if (!provider || !client) {
            throw new Error(`Provider ${providerName} not initialized`)
        }

        console.log(`Revising text with provider: ${providerName} (${provider.type}), action: ${action}`)

        // Get the appropriate template for this model
        const template = getRevisionTemplateForModel(provider.model)
        const { completionOptions } = template
        const prompt = template.buildPrompts(
            text,
            action,
            customPrompt,
            options.prefix || '',
            options.suffix || '',
        )

        console.log('Revision user prompt preview:', prompt.userPrompt.substring(0, 200) + '...')

        const temperature = completionOptions?.temperature || 0.3
        const maxTokens = completionOptions?.maxTokens || 2000

        try {
            if (provider.type === 'claude') {
                const response = await client.messages.create({
                    model: provider.model,
                    max_tokens: maxTokens,
                    temperature: temperature,
                    messages: [{
                        role: 'user',
                        content: prompt.userPrompt
                    }]
                })
            
                const revisedText = response.content
                    .filter((block: { type: string }) => block.type === 'text')
                    .map((block: { text: string }) => block.text)
                    .join('')
                console.log('Claude revision completed:', revisedText.substring(0, 100) + '...')
                return revisedText || text
            } else {
                // OpenAI-compatible API (OpenAI, Azure, Ollama, LiteLLM)
                const requestBody: any = {
                    model: provider.model,
                    temperature: temperature,
                    max_tokens: maxTokens,
                    messages: [{
                        role: 'system',
                        content: prompt.systemPrompt
                    }, {
                        role: 'user',
                        content: prompt.userPrompt
                    }],
                }

                // Disable thinking mode for revision
                requestBody.enable_thinking = false

                const response = await client.chat.completions.create(requestBody)
                const revisedText = response.choices[0].message.content || text

                console.log('Revision completed:', revisedText.substring(0, 100) + '...')
                return revisedText
            }
        } catch (error) {
            console.error('Error revising text:', error)
            throw error
        }
    }

    getProvider(name: string): AIProvider | undefined {
        return this.providers.get(name)
    }

    hasProvider(name: string): boolean {
        return this.providers.has(name)
    }
}

export const aiService = new AIService()
