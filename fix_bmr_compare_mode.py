with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    content = f.read()

original = content

# ── 1. Add bmrCompareOffers ref ──────────────────────────────────
old_refs = "    const bmrStep=ref(1),bmrFile=ref(null),bmrDragOver=ref(false),bmrAnalysis=ref(null),bmrMarketConditions=ref('balanced'),bmrSubjectDom=ref(''),bmrQualityWarnings=ref([]),bmrNExcluded=ref(0),bmrNoSubject=ref(false);"
new_refs  = "    const bmrStep=ref(1),bmrFile=ref(null),bmrDragOver=ref(false),bmrAnalysis=ref(null),bmrMarketConditions=ref('balanced'),bmrSubjectDom=ref(''),bmrQualityWarnings=ref([]),bmrNExcluded=ref(0),bmrNoSubject=ref(false),bmrCompareOffers=ref({});"
assert old_refs in content, "refs not found"
content = content.replace(old_refs, new_refs, 1)
print("1. bmrCompareOffers ref added")

# ── 2. Reset bmrCompareOffers in bmrReset ────────────────────────
old_reset = "bmrQualityWarnings.value=[];bmrNExcluded.value=0;bmrLastRegen.value='';bmrNoSubject.value=false;}"
new_reset  = "bmrQualityWarnings.value=[];bmrNExcluded.value=0;bmrLastRegen.value='';bmrNoSubject.value=false;bmrCompareOffers.value={};}"
assert old_reset in content, "reset not found"
content = content.replace(old_reset, new_reset, 1)
print("2. Reset updated")

# ── 3. Expose bmrCompareOffers in return ─────────────────────────
old_return = "bmrNoSubject,bmrSetAsSubject,"
new_return  = "bmrNoSubject,bmrSetAsSubject,bmrCompareOffers,"
assert old_return in content, "return not found"
content = content.replace(old_return, new_return, 1)
print("3. Return updated")

# ── 4. Unblock Continue button + hide Narrative when no-subject ──
old_continue = """                <div v-if="bmrRegenError" style="color:#dc2626;font-size:12px;margin-bottom:8px;">{{ bmrRegenError }}</div>
                <textarea class="form-input" v-model="bmrAnalysis.narrative" rows="5" style="width:100%;resize:vertical;"></textarea>
                <h3 style="font-size:16px;font-weight:700;color:var(--navy);margin:16px 0 12px;">Offer Guidance</h3>
                <textarea class="form-input" v-model="bmrAnalysis.offer_guidance" rows="4" style="width:100%;resize:vertical;"></textarea>
              </div>
              <div style="display:flex;gap:12px;">
                <button class="btn-secondary" @click="bmrStep=1">← Back</button>
                <button class="btn-primary" style="flex:1;" :disabled="bmrNoSubject" :title="bmrNoSubject?\'Select a subject property first\':\'\'" @click="bmrStep=3">{{ bmrNoSubject ? "Select a subject property to continue" : "Continue to Offer Details →" }}</button>
              </div>"""

new_continue = """                <template v-if="!bmrNoSubject">
                  <div v-if="bmrRegenError" style="color:#dc2626;font-size:12px;margin-bottom:8px;">{{ bmrRegenError }}</div>
                  <textarea class="form-input" v-model="bmrAnalysis.narrative" rows="5" style="width:100%;resize:vertical;"></textarea>
                  <h3 style="font-size:16px;font-weight:700;color:var(--navy);margin:16px 0 12px;">Offer Guidance</h3>
                  <textarea class="form-input" v-model="bmrAnalysis.offer_guidance" rows="4" style="width:100%;resize:vertical;"></textarea>
                </template>
                <div v-if="bmrNoSubject" style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px 16px;margin-top:4px;">
                  <div style="font-weight:700;font-size:13px;color:#166534;margin-bottom:4px;">Comparison mode — all properties will be analyzed independently</div>
                  <div style="font-size:12px;color:#15803d;line-height:1.6;">You'll set a suggested offer for each property in the next step. Market conditions above apply to all.</div>
                </div>
              </div>
              <div style="display:flex;gap:12px;">
                <button class="btn-secondary" @click="bmrStep=1">← Back</button>
                <button class="btn-primary" style="flex:1;" @click="bmrStep=3">{{ bmrNoSubject ? "Compare All Properties →" : "Continue to Offer Details →" }}</button>
              </div>"""

assert old_continue in content, "Continue block not found"
content = content.replace(old_continue, new_continue, 1)
print("4. Continue button unblocked, narrative hidden in compare mode")

# ── 5. Replace Step 3 with dual-mode UI ──────────────────────────
old_step3 = """            <!-- STEP 3 -->
            <template v-if="bmrStep===3">
              <div class="card" style="padding:24px;margin-bottom:20px;">
                <h3 style="font-size:16px;font-weight:700;color:var(--navy);margin-bottom:16px;">Offer Details</h3>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                  <div><label class="form-label">Client Name</label><input class="form-input" v-model="bmrClientName" placeholder="e.g. The Johnson Family" style="width:100%;"></div>
                  <div><label class="form-label">Recommended Offer Price</label><input class="form-input" v-model="bmrOfferPrice" placeholder="e.g. $625,000" style="width:100%;"></div>
                </div>
                <div style="margin-bottom:16px;"><label class="form-label" style="margin-bottom:8px;display:block;">Report Title</label><input class="form-input" v-model="bmrReportTitle" placeholder="e.g. Market Report: 1234 Main St NW" style="width:100%;"></div>

                <div>
                  <label class="form-label" style="margin-bottom:8px;display:block;">Offer Terms <span style="font-size:11px;font-weight:400;color:var(--muted);">(check all that apply)</span></label>
                  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">
                    <label v-for="t in bmrTermOptions" :key="t" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;border:1px solid var(--border);border-radius:6px;"
                           :style="{background:bmrOfferTerms.includes(t)?'#eff6ff':'',borderColor:bmrOfferTerms.includes(t)?'#3b82f6':'var(--border)'}">
                      <input type="checkbox" :value="t" v-model="bmrOfferTerms" style="accent-color:var(--navy);"><span style="font-size:13px;">{{ t }}</span>
                    </label>
                  </div>
                </div>
              </div>"""

new_step3 = """            <!-- STEP 3 -->
            <template v-if="bmrStep===3">
              <div class="card" style="padding:24px;margin-bottom:20px;">
                <h3 style="font-size:16px;font-weight:700;color:var(--navy);margin-bottom:4px;">{{ bmrNoSubject ? 'Comparison Details' : 'Offer Details' }}</h3>
                <p v-if="bmrNoSubject" style="font-size:13px;color:var(--muted);margin-bottom:16px;">Each property will be analyzed and presented independently. Enter a suggested offer for each option.</p>

                <!-- Client name + report title (both modes) -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
                  <div><label class="form-label">Client Name</label><input class="form-input" v-model="bmrClientName" placeholder="e.g. The Johnson Family" style="width:100%;"></div>
                  <div v-if="!bmrNoSubject"><label class="form-label">Recommended Offer Price</label><input class="form-input" v-model="bmrOfferPrice" placeholder="e.g. $625,000" style="width:100%;"></div>
                  <div v-if="bmrNoSubject"><label class="form-label">Report Title</label><input class="form-input" v-model="bmrReportTitle" placeholder="e.g. Property Comparison Report" style="width:100%;"></div>
                </div>
                <div v-if="!bmrNoSubject" style="margin-bottom:16px;"><label class="form-label" style="margin-bottom:8px;display:block;">Report Title</label><input class="form-input" v-model="bmrReportTitle" placeholder="e.g. Market Report: 1234 Main St NW" style="width:100%;"></div>

                <!-- COMPARISON MODE: per-property offer prices -->
                <template v-if="bmrNoSubject">
                  <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:10px;">Suggested Offer Per Property</div>
                  <div v-for="(cand,ci) in [...(bmrAnalysis.subject?.address?[bmrAnalysis.subject]:[]), ...bmrAnalysis.comps]" :key="ci"
                       style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:13px;font-weight:600;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ cand.address }}</div>
                      <div style="font-size:11px;color:var(--muted);margin-top:2px;">{{ [cand.beds&&(cand.beds+'bd'), cand.baths&&(cand.baths+'ba'), cand.sqft&&(cand.sqft+' sqft'), cand.list_price].filter(Boolean).join(' · ') }}</div>
                    </div>
                    <input class="form-input" v-model="bmrCompareOffers[ci]" placeholder="Offer price" style="width:160px;flex-shrink:0;">
                  </div>
                </template>

                <!-- STANDARD MODE: offer terms -->
                <template v-if="!bmrNoSubject">
                  <div>
                    <label class="form-label" style="margin-bottom:8px;display:block;">Offer Terms <span style="font-size:11px;font-weight:400;color:var(--muted);">(check all that apply)</span></label>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">
                      <label v-for="t in bmrTermOptions" :key="t" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 12px;border:1px solid var(--border);border-radius:6px;"
                             :style="{background:bmrOfferTerms.includes(t)?'#eff6ff':'',borderColor:bmrOfferTerms.includes(t)?'#3b82f6':'var(--border)'}">
                        <input type="checkbox" :value="t" v-model="bmrOfferTerms" style="accent-color:var(--navy);"><span style="font-size:13px;">{{ t }}</span>
                      </label>
                    </div>
                  </div>
                </template>
              </div>"""

assert old_step3 in content, "Step 3 block not found"
content = content.replace(old_step3, new_step3, 1)
print("5. Step 3 dual-mode UI added")

# ── 6. Update Deploy button guard for compare mode ───────────────
old_deploy_btn = '                <button class="btn-primary" style="flex:1;" :disabled="!bmrClientName||!bmrOfferPrice||!bmrReportTitle||!bmrDisclaimerAck||bmrDeploying" @click="bmrDeploy">'
new_deploy_btn = '                <button class="btn-primary" style="flex:1;" :disabled="!bmrClientName||(!bmrNoSubject&&!bmrOfferPrice)||!bmrReportTitle||!bmrDisclaimerAck||bmrDeploying" @click="bmrDeploy">'
assert old_deploy_btn in content, "Deploy button not found"
content = content.replace(old_deploy_btn, new_deploy_btn, 1)
print("6. Deploy button guard updated for compare mode")

# ── 7. Update bmrDeploy to handle comparison mode ────────────────
old_deploy_body = "        const res=await fetch(CC_RAILWAY_URL+'/api/buyer-report/deploy',{\n          method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},\n          body:JSON.stringify({analysis:bmrAnalysis.value,offer_price:bmrOfferPrice.value,offer_terms:bmrOfferTerms.value,client_name:bmrClientName.value,agent_name:aName,agent_email:AGENT_EMAILS[aName]||'',agent_phone:AGENT_PHONES[aName]||'',report_title:bmrReportTitle.value,market_conditions:bmrMarketConditions.value,subject_dom:parseInt(bmrSubjectDom.value)||0}),"
new_deploy_body = """        // Build payload — comparison mode or standard
        const candidates = bmrNoSubject.value
          ? [...(bmrAnalysis.value.subject?.address?[bmrAnalysis.value.subject]:[]), ...bmrAnalysis.value.comps]
              .map((c,i)=>({...c, suggested_offer: bmrCompareOffers.value[i]||''}))
          : null;
        const deployPayload = bmrNoSubject.value
          ? {comparison_mode:true, candidates, client_name:bmrClientName.value, agent_name:aName, agent_email:AGENT_EMAILS[aName]||'', agent_phone:AGENT_PHONES[aName]||'', report_title:bmrReportTitle.value, market_conditions:bmrMarketConditions.value, offer_terms:bmrOfferTerms.value}
          : {analysis:bmrAnalysis.value, offer_price:bmrOfferPrice.value, offer_terms:bmrOfferTerms.value, client_name:bmrClientName.value, agent_name:aName, agent_email:AGENT_EMAILS[aName]||'', agent_phone:AGENT_PHONES[aName]||'', report_title:bmrReportTitle.value, market_conditions:bmrMarketConditions.value, subject_dom:parseInt(bmrSubjectDom.value)||0};
        const res=await fetch(CC_RAILWAY_URL+'/api/buyer-report/deploy',{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},
          body:JSON.stringify(deployPayload),"""
assert old_deploy_body in content, "Deploy body not found"
content = content.replace(old_deploy_body, new_deploy_body, 1)
print("7. bmrDeploy updated for comparison mode")

assert content != original, "No changes made"
with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(content)
print("\nAll 7 changes applied successfully")

# ── 7 (retry). Update bmrDeploy to handle comparison mode ────────
with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    content = f.read()

old_deploy_body = """        try{ res=await fetch(CC_RAILWAY_URL+'/api/buyer-report/deploy',{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},
          body:JSON.stringify({analysis:bmrAnalysis.value,offer_price:bmrOfferPrice.value,offer_terms:bmrOfferTerms.value,client_name:bmrClientName.value,agent_name:aName,agent_email:AGENT_EMAILS[aName]||'',agent_phone:AGENT_PHONES[aName]||'',report_title:bmrReportTitle.value,market_conditions:bmrMarketConditions.value,subject_dom:parseInt(bmrSubjectDom.value)||0}),
          signal:ctrl2.signal}); }"""

new_deploy_body = """        const _candidates = bmrNoSubject.value
          ? [...(bmrAnalysis.value.subject?.address?[bmrAnalysis.value.subject]:[]), ...bmrAnalysis.value.comps]
              .map((c,i)=>({...c, suggested_offer: bmrCompareOffers.value[i]||''}))
          : null;
        const _payload = bmrNoSubject.value
          ? {comparison_mode:true, candidates:_candidates, client_name:bmrClientName.value, agent_name:aName, agent_email:AGENT_EMAILS[aName]||'', agent_phone:AGENT_PHONES[aName]||'', report_title:bmrReportTitle.value, market_conditions:bmrMarketConditions.value, offer_terms:bmrOfferTerms.value}
          : {analysis:bmrAnalysis.value, offer_price:bmrOfferPrice.value, offer_terms:bmrOfferTerms.value, client_name:bmrClientName.value, agent_name:aName, agent_email:AGENT_EMAILS[aName]||'', agent_phone:AGENT_PHONES[aName]||'', report_title:bmrReportTitle.value, market_conditions:bmrMarketConditions.value, subject_dom:parseInt(bmrSubjectDom.value)||0};
        try{ res=await fetch(CC_RAILWAY_URL+'/api/buyer-report/deploy',{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},
          body:JSON.stringify(_payload),
          signal:ctrl2.signal}); }"""

assert old_deploy_body in content, "Deploy fetch not found"
content = content.replace(old_deploy_body, new_deploy_body, 1)
print("7. bmrDeploy updated for comparison mode")

with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(content)
print("Done")
