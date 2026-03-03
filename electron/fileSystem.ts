import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

export class FileSystemHelper {
    static async ensureDirectory(dirPath: string): Promise<void> {
        if (!existsSync(dirPath)) {
            await fs.mkdir(dirPath, { recursive: true })
        }
    }

    static async readJsonFile(filePath: string): Promise<any> {
        try {
            const content = await fs.readFile(filePath, 'utf-8')
            return JSON.parse(content)
        } catch (error) {
            return null
        }
    }

    static async writeJsonFile(filePath: string, data: any): Promise<void> {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    }

    static isPathSafe(basePath: string, requestedPath: string): boolean {
        const resolvedPath = path.resolve(basePath, requestedPath)
        return resolvedPath.startsWith(basePath)
    }
}
