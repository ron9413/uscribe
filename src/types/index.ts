// Note types
export interface Note {
    id: string;
    title: string;
    content: string;
    createdAt: string;
    updatedAt: string;
    folder?: string;
    tags?: string[];
}

export interface NoteMetadata {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    folder?: string;
    tags?: string[];
}

// AI Provider types
export interface AIProvider {
    name: string;
    type: 'openai' | 'azure' | 'claude' | 'ollama' | 'litellm';
    apiKey?: string;
    baseUrl?: string;
    model: string;
}

export interface CustomRevisionShortcut {
    id: string;
    name: string;
    prompt: string;
    accelerator: string;
    scope?: 'global' | 'local';
}

export interface AIConfig {
    providers: AIProvider[];
    activeProvider: string;
    autoCompleteEnabled: boolean;
    autoCompleteDelay: number;
    customRevisionShortcuts: CustomRevisionShortcut[];
}

// Revision actions
export type RevisionAction =
    | 'revise'
    | 'custom';

export interface RevisionRequest {
    text: string;
    action: RevisionAction;
    customPrompt?: string;
}

export interface RevisionResult {
    original: string;
    revised: string;
    diff: string;
}

// IPC types for Electron
export interface ElectronAPI {
    // File operations
    readNote: (id: string) => Promise<Note | null>;
    writeNote: (note: Note) => Promise<void>;
    deleteNote: (id: string) => Promise<void>;
    listNotes: () => Promise<NoteMetadata[]>;

    // Config operations
    getConfig: () => Promise<AIConfig>;
    saveConfig: (config: AIConfig) => Promise<void>;

    // Secure storage
    storeApiKey: (provider: string, key: string) => Promise<void>;
    getApiKey: (provider: string) => Promise<string | null>;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
