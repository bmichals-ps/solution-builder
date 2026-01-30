# Reference CSV Analysis: Travelers Insurance

## Stats
- **560 nodes** (261 Decision, 299 Action)
- **26 columns** (with CSS Classname as #26)
- **82 unique commands** (action node scripts)
- Node numbering: 1 to 156,121 (sparse, not sequential)

## Key Format Patterns

### Button (Rich Asset Type: `button`)
```
label~nextNode|label~nextNode
```
- FontAwesome icons: `<<far fa-check>> Yes~440`
- Multiline OK: each option on new line with `|` separator
- Single button: `Start over~1`

### Quick Reply (Rich Asset Type: `quick_reply`)
```json
{"type":"static","options":[{"label":"text","dest":nodeNum}]}
```

### Selection (Rich Asset Type: `selection`)
JSON with type/options

### Webview (Rich Asset Type: `webview`)
```
description~https://url?params
```

### What Next (Action nodes)
```
true~nextNode|error~errorNode
```

### Decision Variables
Only 5 used: `found_regex`, `next_node`, `phone_type`, `success`, `valid`

### Action Node Message
Only 4 out of 299 action nodes have Message content (rare, mostly logging)

### Variables
ALL_CAPS format: `CHATID`, `CHECKLASTURL`, `SESSION_ID`, etc.
