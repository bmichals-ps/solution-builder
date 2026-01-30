# CSV Validation Refinement Plan

**Goal:** Zero-error CSV output without relying on AI refinement as a crutch.

**Core Problem:** The AI generates CSVs with validation errors, then a second AI tries to fix them and often makes things worse (7 errors → 70). The fix loop is slow, fragile, and unreliable.

**Philosophy:** Programmatic fixes > AI fixes. Every error the AI has to fix is a failure of the pipeline upstream.

---

## Phase 1: Stop the Bleeding ✅ DONE
*Shipped Jan 30 — prevents error explosions*

- [x] **Row-level AI refinement** — AI only sees/edits broken rows, spliced back into original CSV. Prevents mangling untouched rows.
- [x] **Fix false-positive "FIX NOT APPLIED"** — Check specific node row, not entire CSV string.
- [x] **AI output guard rails** — Before accepting AI's fix, validate:
  - Row count didn't change (no rows added/removed unless intentional)
  - Every row has exactly 26 columns
  - No node numbers changed
  - Reject the fix entirely if it fails these checks (keep original CSV, log warning)

## Phase 2: Expand Programmatic Fixes ✅ DONE
*Shipped Jan 30 — deterministic fixes for 80%+ of errors*

Audited error-learning database. NLU_DISABLED_MULTI_CHILD = 80% of all errors (104/129).

- [x] **Audit error patterns** — Queried Supabase, ranked by frequency
- [x] **NLU Disabled catch-all** — Clear if Rich Asset Type implies multi-route (button/listpicker/quick_reply/carousel)
- [x] **Missing references** — Auto-reroute orphan refs to nearest valid node (Next Nodes, What Next, buttons, JSON dests)
- [x] **Decision variable mismatch** — Set to "success" with standard What Next routing
- [x] **Parameter Input JSON** — Array→object, brace balance, unquoted vars, placeholder fallback
- [x] **Variable ALL_CAPS** — Force uppercase with underscore separators
- [x] **Answer Required** — Set to 1 for datepicker/timepicker/file_upload
- [x] **Node Number not integer** — Remove orphan rows from broken multi-line messages
- [x] **Empty required fields** — Already handled (Command → SysAssignVariable placeholder)
- [x] **Dead-end detection** — Already handled (add recovery buttons)
- [x] **What Next format** — Already handled (append |error~99990)

## Phase 3: Better Initial Generation ✅ DONE  
*Shipped Jan 30 — normalize CSV output at the source*

- [x] **CSV normalization layer** — `normalizeCSVColumns()` runs after both generation and refinement:
  - Enforces exactly 26 columns per row (pad short, merge excess)
  - Intelligently merges unescaped commas back into correct fields (JSON detection)
  - Removes rows with non-integer Node Numbers
  - Validates field types (NLU/AnsReq = 0/1/empty, Variables ALL_CAPS)
- [x] **CSV examples in generation prompt** — Already extensive (system nodes, feature flow templates, NLU patterns, all rich asset types)
- [ ] **Column-by-column generation** — Instead of generating free-form CSV rows, use structured output (JSON per node) then serialize to CSV deterministically
- [ ] **Node template library** — Pre-built correct templates for common patterns
- [ ] **Validation during generation** — Run `structuralPreValidation` on partial output as it's generated

## Phase 4: Eliminate AI Refinement Loop
*Make AI refinement the exception, not the rule*

- [ ] **Two-pass programmatic pipeline:**
  1. Generate CSV (AI)
  2. `structuralPreValidation` (programmatic — all known fixes)
  3. `sanitizeCSVForDeploy` (programmatic — format cleanup)
  4. Bot Manager API validation
  5. If errors remain: **programmatic fix pass** targeting specific error types
  6. Re-validate
  7. **Only if programmatic fixes can't handle it:** AI refinement (row-level)
- [ ] **Track AI refinement rate** — Log what % of generations need AI refinement. Target: <10%
- [ ] **Error type classification** — Tag each error as "programmatic-fixable" vs "needs-AI". Only send AI-requiring errors to the AI refiner.

## Phase 5: Feedback Loop
*Learn from every generation to improve over time*

- [ ] **Error pattern dashboard** — Simple UI showing top error types, fix success rates
- [ ] **Auto-generate programmatic fixes** — When an error pattern hits 10+ occurrences with a consistent AI fix, auto-generate a deterministic fix function
- [ ] **Generation quality score** — Track errors-per-generation over time, alert if regression

---

## Metrics to Track
- Errors per initial generation (before any fixes)
- % of errors fixed programmatically vs AI
- AI refinement iterations needed (target: 0-1)
- Time per generation pipeline (target: <60s)
- Error explosion rate (errors increasing after fix attempt — target: 0%)

## Current State
- `structuralPreValidation`: ~15 fix types
- `sanitizeCSVForDeploy`: ~17 fix types  
- `applyProgrammaticFixForError`: 3 fix types (pipe chars, NLU disabled, JSON)
- AI refinement: Full CSV → row-level (just shipped)
- Typical generation: 2-3 iterations, 3-10 errors, ~4 min total
