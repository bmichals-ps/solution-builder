/**
 * Vite Plugin Exports
 * 
 * Modular middleware plugins for the Solution Builder
 */

export { spaFallbackPlugin } from './spa-fallback'
export { composioMiddlewarePlugin } from './composio-middleware'
export { aiQuestionsMiddlewarePlugin } from './ai-questions-middleware'
export { aiPromptAnalysisPlugin } from './ai-prompt-analysis'
export { aiEditMiddlewarePlugin } from './ai-edit-middleware'
export { brandfetchMiddlewarePlugin } from './brandfetch-middleware'
export { pypestreamDocsMiddlewarePlugin } from './pypestream-docs-middleware'

// TODO: Extract remaining large plugins:
// - ai-generation-middleware (~2100 lines) - complex with context caching, doc fetching
// - botmanager-api-middleware (~2000 lines) - validation, upload, deploy, channel creation
// 
// These are currently kept inline in vite.config.ts until extracted.
// Original backup is in vite.config.backup.ts
