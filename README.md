# uScribe

uScribe is your personal AI-powered writing assistant that helps you draft and refine content seamlessly - wherever you type.

## What uScribe does

- Rich note editor for writing and organizing notes
- AI autocomplete while you type
- Inline text revision with accept/reject preview
- Global revision shortcuts that work outside the app
- Configurable providers: OpenAI, Azure OpenAI, Claude, Ollama, LiteLLM
- Custom revision shortcuts (local or global)

## How “revise anywhere” works

When uScribe is not focused and you trigger a global shortcut, it:
1. Copies your selected text from the active app
2. Sends it to your active AI provider for revision
3. Pastes the revised text back into the original app

Built-in global shortcuts:
- `Ctrl/Cmd + Shift + 1`: Revise Text
- `Ctrl/Cmd + Shift + 2`: Quick Edit (prompts for a custom instruction)

## In-app shortcuts

- `Tab`: Accept autocomplete suggestion
- `Esc`: Dismiss autocomplete suggestion
- `Shift + Tab`: Toggle autocomplete on/off

## Tech stack

- Electron + Vite + React + TypeScript
- Lexical editor for rich text editing
- `robotjs` + Electron global shortcuts for cross-app revision

## Prerequisites

- Node.js 18+ (recommended)
- npm
- For local models: Ollama (optional, install from https://ollama.com/download first)

## Platform support note

uScribe has been mainly tested on macOS. Windows and Linux support is available but has not been fully tested yet.

## Getting started

```bash
npm install
npm run dev
```

Then open **Settings** in the app and:
1. Add at least one AI provider
2. Save/select an active provider
3. (Optional) Add custom shortcuts and set their scope (`local` or `global`)

## Provider notes

- **OpenAI / Claude / Azure / LiteLLM**: API key required
- **Ollama**: no real API key required (`ollama` is used internally)
- **Azure**: endpoint/base URL is required

## Build and package

```bash
npm run build
```

Useful scripts:
- `npm run dev` – run in development
- `npm run build` – production build + packaging
- `npm run build:dir` – unpacked build output
- `npm run typecheck` – TypeScript check
- `npm run lint` – ESLint
- `npm run rebuild:native` – rebuild native deps (e.g., `robotjs`)

## Data and security

uScribe stores:
- **Notes** as JSON files in your Documents folder under `Documents/uscribe`
- **Config** in Electron app `userData` (`config.json`)
- **API keys** encrypted with Electron `safeStorage` in `userData` (`keys.json`)

If run outside Electron (browser-only fallback), localStorage is used instead.

## Troubleshooting

- macOS global shortcuts not triggering:
	- Grant uScribe access in **Privacy & Security → Accessibility**
- Notes not saving/loading on macOS:
	- Allow uScribe access to the **Documents** folder (notes are stored in `Documents/uscribe`)
- Global shortcuts not triggering:
	- Ensure uScribe is running and has registered shortcuts
	- Check if another app already owns the same shortcut
- Background revision says no provider:
	- Set an active provider in Settings
- Native module issues (`robotjs`) after install/update:
	- Run `npm run rebuild:native`

## License

See [LICENSE](LICENSE).
