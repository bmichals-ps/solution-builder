import type { Plugin } from 'vite'

/**
 * Brandfetch API Middleware
 * Automatic brand detection for colors, logos, and fonts
 */
export function brandfetchMiddlewarePlugin(): Plugin {
  return {
    name: 'brandfetch-middleware',
    async configureServer(server) {
      server.middlewares.use('/api/brandfetch', async (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        
        if (req.method === 'OPTIONS') {
          res.statusCode = 200
          res.end()
          return
        }
        
        if (req.method !== 'POST') {
          next()
          return
        }
        
        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', async () => {
          try {
            const { query } = JSON.parse(body)
            const apiKey = process.env.BRANDFETCH_API_KEY
            
            if (!apiKey) {
              console.log('[Brandfetch] No API key configured')
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: 'BRANDFETCH_API_KEY not configured' }))
              return
            }
            
            if (!query) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: 'Query is required' }))
              return
            }
            
            console.log('[Brandfetch] Searching for brand:', query)
            
            const queryLower = query.toLowerCase().replace(/[^a-z0-9]/g, '')
            
            // Search for the brand
            const searchResponse = await fetch(
              `https://api.brandfetch.io/v2/search/${encodeURIComponent(query)}`,
              {
                headers: { 'Authorization': `Bearer ${apiKey}` }
              }
            )
            
            if (!searchResponse.ok) {
              console.log('[Brandfetch] Search failed:', searchResponse.status)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: `Search failed: ${searchResponse.status}` }))
              return
            }
            
            const searchResults = await searchResponse.json()
            console.log('[Brandfetch] Search results:', searchResults.length, 'found')
            
            if (!searchResults || searchResults.length === 0) {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: 'No brands found' }))
              return
            }
            
            // Smart matching function
            const findBestMatch = (results: any[]) => {
              const exactDomain = results.find((r: any) => {
                const domainBase = r.domain?.split('.')[0]?.toLowerCase()
                return domainBase === queryLower
              })
              if (exactDomain) return exactDomain
              
              const exactName = results.find((r: any) => {
                const nameLower = r.name?.toLowerCase().replace(/[^a-z0-9]/g, '')
                return nameLower === queryLower
              })
              if (exactName) return exactName
              
              const domainStarts = results.find((r: any) => {
                const domainBase = r.domain?.split('.')[0]?.toLowerCase()
                return domainBase?.startsWith(queryLower) && !domainBase.includes('remote')
              })
              if (domainStarts) return domainStarts
              
              return results[0]
            }
            
            const bestMatch = findBestMatch(searchResults)
            const domain = bestMatch.domain
            console.log('[Brandfetch] Selected domain:', domain)
            
            // Fetch full brand data
            const brandResponse = await fetch(
              `https://api.brandfetch.io/v2/brands/${domain}`,
              { headers: { 'Authorization': `Bearer ${apiKey}` } }
            )
            
            if (!brandResponse.ok) {
              console.log('[Brandfetch] Brand fetch failed:', brandResponse.status)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: `Brand fetch failed: ${brandResponse.status}` }))
              return
            }
            
            const brandData = await brandResponse.json()
            console.log('[Brandfetch] Brand data received:', brandData.name)
            
            // Extract colors
            const colors = (brandData.colors || []).map((c: any) => ({
              name: c.type || 'primary',
              hex: c.hex,
              usage: c.type === 'accent' ? 'accent' : c.type === 'dark' ? 'secondary' : 'primary',
            }))
            
            // Color helpers
            const isNearWhite = (hex: string) => {
              if (!hex) return false
              const cleanHex = hex.replace('#', '')
              const r = parseInt(cleanHex.slice(0, 2), 16)
              const g = parseInt(cleanHex.slice(2, 4), 16)
              const b = parseInt(cleanHex.slice(4, 6), 16)
              return (r > 240 && g > 240 && b > 240)
            }
            
            const isNearBlack = (hex: string) => {
              if (!hex) return false
              const cleanHex = hex.replace('#', '')
              const r = parseInt(cleanHex.slice(0, 2), 16)
              const g = parseInt(cleanHex.slice(2, 4), 16)
              const b = parseInt(cleanHex.slice(4, 6), 16)
              return (r < 30 && g < 30 && b < 30)
            }
            
            const usableColors = colors.filter((c: any) => 
              c.hex && !isNearWhite(c.hex) && !isNearBlack(c.hex)
            )
            
            const darkColors = colors.filter((c: any) => c.hex && c.usage === 'secondary')
            const accentColors = colors.filter((c: any) => c.hex && c.usage === 'accent')
            
            let primaryColor = darkColors[0]?.hex
            if (!primaryColor || isNearBlack(primaryColor)) {
              const colorfulOption = usableColors.find((c: any) => 
                c.hex && !isNearBlack(c.hex) && !isNearWhite(c.hex)
              )?.hex || accentColors[0]?.hex
              primaryColor = colorfulOption || usableColors[0]?.hex || '#1E3A5F'
            }
            
            const secondaryColor = accentColors[0]?.hex 
              || usableColors.find((c: any) => c.hex !== primaryColor)?.hex
              || '#3B82F6'
            
            // Extract logos
            const logos = (brandData.logos || []).flatMap((logo: any) => 
              (logo.formats || []).map((format: any) => ({
                url: format.src,
                type: logo.type === 'symbol' ? 'icon' : logo.type === 'wordmark' ? 'wordmark' : 'primary',
                format: format.format,
                background: format.background || logo.theme || 'transparent',
              }))
            )
            
            const logoPriority = [
              logos.find((l: any) => l.type === 'icon' && l.format === 'png'),
              logos.find((l: any) => l.type === 'icon' && l.format === 'jpeg'),
              logos.find((l: any) => l.type === 'icon' && l.format === 'svg'),
              logos.find((l: any) => l.type === 'icon'),
              logos.find((l: any) => l.type === 'primary' && l.format === 'png'),
              logos.find((l: any) => l.type === 'primary'),
              logos[0],
            ]
            const bestLogo = logoPriority.find(l => l) || { url: '', background: 'transparent' }
            const logoUrl = bestLogo?.url || ''
            const logoBackground = bestLogo?.background || 'transparent'
            
            // Extract fonts
            const fonts = (brandData.fonts || []).map((f: any) => ({
              name: f.name,
              type: f.type || 'body',
              origin: f.origin,
              originId: f.originId,
              weights: f.weights,
            }))
            
            // Extract images
            const images = (brandData.images || []).map((img: any) => ({
              url: img.formats?.[0]?.src || img.src || '',
              type: img.type || 'banner',
            })).filter((img: any) => img.url)
            
            const brandAssets = {
              name: brandData.name,
              domain: domain,
              colors: colors,
              logos: logos,
              fonts: fonts,
              images: images,
              primaryColor: primaryColor,
              secondaryColor: secondaryColor,
              logoUrl: logoUrl,
              logoBackground: logoBackground,
            }
            
            console.log('[Brandfetch] Returning brand assets:', {
              name: brandAssets.name,
              primaryColor: brandAssets.primaryColor,
              logoUrl: logoUrl || 'none',
            })
            
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ success: true, brand: brandAssets }))
            
          } catch (e: any) {
            console.error('[Brandfetch] Error:', e)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ success: false, error: e.message || String(e) }))
          }
        })
      })
    }
  }
}
