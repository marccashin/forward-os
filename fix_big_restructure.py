with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    html = f.read()

# ═══════════════════════════════════════════════════════════════════════════════
# 1. UPDATE PIPELINE STEPS — brand auditor names + descriptions
# ═══════════════════════════════════════════════════════════════════════════════
old_pipe = "    const lstPipelineSteps = ['Strategist', 'Copywriter', 'Brand Kit', 'Campaign Director', 'Brand Guardian'];"
new_pipe = """    const lstPipelineSteps = [
      { name: 'Brand Strategist', desc: 'Analyzing property, comps, and target buyer profiles' },
      { name: 'Copywriter', desc: 'Drafting social copy, flyer, and listing remarks' },
      { name: 'Brand Auditor', desc: 'Reviewing all copy against FORWARD voice & tone standards' },
      { name: 'Campaign Director', desc: 'Building 30-day marketing timeline and channel plan' },
      { name: 'Brand Guardian', desc: 'Final review — compliance, accuracy, and quality sign-off' }
    ];"""
assert old_pipe in html, "pipeline steps not found"
html = html.replace(old_pipe, new_pipe, 1)

# Update pipeline display
old_pipe_display = """                <div v-for="(step,si) in lstPipelineSteps" :key="si" style="display:flex;align-items:flex-start;gap:14px;">
                  <div style="display:flex;flex-direction:column;align-items:center;">
                    <div :class="['pipeline-step-circle', si < lstPipelineActiveStep ? 'done' : si === lstPipelineActiveStep ? 'active' : 'pending']">
                      {{ si < lstPipelineActiveStep ? '✓' : (si + 1) }}
                    </div>
                    <div v-if="si < lstPipelineSteps.length - 1" class="pipeline-connector" :style="{background: si < lstPipelineActiveStep ? 'var(--gold)' : '#374151'}"></div>
                  </div>
                  <div style="padding-top:3px;">
                    <div :style="{fontSize:'14px',fontWeight:si===lstPipelineActiveStep?'700':'500',color:si<=lstPipelineActiveStep?'var(--gold)':'rgba(255,255,255,0.4)',transition:'all .4s'}">{{ step }}</div>
                  </div>
                </div>"""
new_pipe_display = """                <div v-for="(step,si) in lstPipelineSteps" :key="si" style="display:flex;align-items:flex-start;gap:14px;padding-bottom:4px;">
                  <div style="display:flex;flex-direction:column;align-items:center;">
                    <div :class="['pipeline-step-circle', si < lstPipelineActiveStep ? 'done' : si === lstPipelineActiveStep ? 'active' : 'pending']">
                      {{ si < lstPipelineActiveStep ? '✓' : (si + 1) }}
                    </div>
                    <div v-if="si < lstPipelineSteps.length - 1" class="pipeline-connector" :style="{background: si < lstPipelineActiveStep ? 'var(--gold)' : '#374151'}"></div>
                  </div>
                  <div style="padding-top:3px;padding-bottom:10px;">
                    <div :style="{fontSize:'13px',fontWeight:si===lstPipelineActiveStep?'700':'500',color:si<=lstPipelineActiveStep?'var(--gold)':'rgba(255,255,255,0.4)',transition:'all .4s'}">{{ step.name }}</div>
                    <div v-if="si===lstPipelineActiveStep" style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:3px;line-height:1.4;">{{ step.desc }}</div>
                  </div>
                </div>"""
assert old_pipe_display in html, "pipeline display not found"
html = html.replace(old_pipe_display, new_pipe_display, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 2. IN-APP CAMPAIGN GENERATOR — live section status
# ═══════════════════════════════════════════════════════════════════════════════
old_campgen_ref = "    const campGenerating = ref(false);"
new_campgen_ref = "    const campGenerating = ref(false);\n    const campCurrentSection = ref('');"
assert old_campgen_ref in html, "campGenerating ref not found"
html = html.replace(old_campgen_ref, new_campgen_ref, 1)

old_gen_start = "  campGenerating.value = true;\n  const special = campSpecialInstructions.value.trim();"
new_gen_start = "  campGenerating.value = true;\n  campCurrentSection.value = 'Brand Strategist — analyzing property and buyer profiles…';\n  const special = campSpecialInstructions.value.trim();"
assert old_gen_start in html, "campGenerating start not found"
html = html.replace(old_gen_start, new_gen_start, 1)

old_gen_try = "  try {\n    const _timeout = new Promise((_,rj)=>setTimeout(()=>rj(new Error('Timed out after 3 minutes — please try again')),180000));\n    const raw = await Promise.race([claude(prompt), _timeout]);"
new_gen_try = "  try {\n    campCurrentSection.value = 'Copywriter — drafting campaign sections…';\n    const _timeout = new Promise((_,rj)=>setTimeout(()=>rj(new Error('Timed out after 3 minutes — please try again')),180000));\n    campCurrentSection.value = 'Brand Auditor — reviewing voice and tone…';\n    const raw = await Promise.race([claude(prompt), _timeout]);\n    campCurrentSection.value = 'Campaign Director — organizing deliverables…';"
assert old_gen_try in html, "campGenerating try block not found"
html = html.replace(old_gen_try, new_gen_try, 1)

old_gen_finally = "  } finally {\n    campGenerating.value = false;\n  }"
new_gen_finally = "  } finally {\n    campGenerating.value = false;\n    campCurrentSection.value = '';\n  }"
assert old_gen_finally in html, "campGenerating finally not found"
html = html.replace(old_gen_finally, new_gen_finally, 1)

old_gen_display = '                <div v-if="campGenerating" style="text-align:center;margin-top:8px;font-size:12px;color:var(--navy);opacity:.75;">Generating 6 campaign sections · this takes ~60 seconds…</div>\n                <div v-if="campGenerating" style="text-align:center;margin-top:6px;font-size:11px;color:#c0392b;font-weight:600;">Stay on this page — navigating away will cancel generation.</div>'
new_gen_display = '                <div v-if="campGenerating" style="margin-top:12px;background:var(--navy);border-radius:2px;padding:14px 16px;">\n                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><span class="spinner" style="border-color:rgba(201,168,76,0.25);border-top-color:var(--gold);width:14px;height:14px;flex-shrink:0;"></span><span style="font-family:\'Montserrat\',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--gold);">Campaign Generating</span></div>\n                  <div style="font-family:\'Cormorant Garamond\',serif;font-size:13px;color:rgba(255,255,255,0.8);line-height:1.4;">{{ campCurrentSection }}</div>\n                  <div style="margin-top:10px;font-family:\'Montserrat\',sans-serif;font-size:7.5px;color:rgba(255,255,255,0.4);letter-spacing:0.08em;">Stay on this page · ~60 seconds</div>\n                </div>'
assert old_gen_display in html, "campGenerating display not found"
html = html.replace(old_gen_display, new_gen_display, 1)

# Add campCurrentSection to setup() return
old_ret_camp = "lstGenerateCampaignInApp, campApproveAndSend, campCopyToClipboard, campExportPDF, campBrokersOpenDays, campPhotoDays, campVideoDays, campSpecialInstructions, campSections, campParsed, campRawResult, campShowPreview, campOpenSection, campRevOpen, campGenerating, campShowSettings,"
new_ret_camp = "lstGenerateCampaignInApp, campApproveAndSend, campCopyToClipboard, campExportPDF, campBrokersOpenDays, campPhotoDays, campVideoDays, campSpecialInstructions, campSections, campParsed, campRawResult, campShowPreview, campOpenSection, campRevOpen, campGenerating, campCurrentSection, campShowSettings,"
assert old_ret_camp in html, "campGenerating return not found"
html = html.replace(old_ret_camp, new_ret_camp, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 3. REMOVE LISTING PHOTOS TOOL
# ═══════════════════════════════════════════════════════════════════════════════
photos_start = html.find("              <!-- Tool: Listing Photos (first tool) -->")
photos_end = html.find("              <!-- Tool: Listing Presentation -->")
assert photos_start > 0 and photos_end > 0, "Photos tool boundaries not found"
html = html[:photos_start] + html[photos_end:]

# ═══════════════════════════════════════════════════════════════════════════════
# 4. RESTRUCTURE TOOLS INTO PRE-LISTING / ACTIVE LISTING SUBCATEGORIES
# ═══════════════════════════════════════════════════════════════════════════════

old_sub_css = "/* ── TOOL LIST (replaces subfolder-panel) ── */"
new_sub_css = """/* ── TOOL CATEGORY HEADERS ── */
.tool-category-header { padding: 10px 20px 8px; background: var(--cream); display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--cream-mid); }
.tool-category-label { font-family: 'Montserrat', sans-serif; font-size: 7px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: var(--gold-muted); }
.tool-category-line { flex: 1; height: 1px; background: var(--cream-dark); }

/* ── TOOL LIST (replaces subfolder-panel) ── */"""
assert old_sub_css in html, "tool list CSS anchor not found"
html = html.replace(old_sub_css, new_sub_css, 1)

# PRE-LISTING header before Listing Presentation
old_pre = "              <!-- Tool: Listing Presentation -->"
new_pre = """              <!-- PRE-LISTING category -->
              <div class="tool-category-header"><span class="tool-category-label">Pre-Listing</span><div class="tool-category-line"></div></div>

              <!-- Tool: Listing Presentation -->"""
assert old_pre in html, "Listing Presentation anchor not found"
html = html.replace(old_pre, new_pre, 1)

# ACTIVE LISTING header before Listing Description (which comes after CMA)
old_active = "              <!-- Tool: Listing Description -->"
new_active = """              <!-- ACTIVE LISTING category -->
              <div class="tool-category-header"><span class="tool-category-label">Active Listing</span><div class="tool-category-line"></div></div>

              <!-- Tool: Listing Description -->"""
assert old_active in html, "Listing Description anchor not found"
html = html.replace(old_active, new_active, 1)

with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(html)
print("index.html done.")
