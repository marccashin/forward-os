with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    content = f.read()

original = content

# ── 1. Add bmrNoSubject ref ───────────────────────────────────────
old_refs = "    const bmrStep=ref(1),bmrFile=ref(null),bmrDragOver=ref(false),bmrAnalysis=ref(null),bmrMarketConditions=ref('balanced'),bmrSubjectDom=ref(''),bmrQualityWarnings=ref([]),bmrNExcluded=ref(0);"
new_refs  = "    const bmrStep=ref(1),bmrFile=ref(null),bmrDragOver=ref(false),bmrAnalysis=ref(null),bmrMarketConditions=ref('balanced'),bmrSubjectDom=ref(''),bmrQualityWarnings=ref([]),bmrNExcluded=ref(0),bmrNoSubject=ref(false);"
assert old_refs in content, "refs line not found"
content = content.replace(old_refs, new_refs, 1)
print("1. bmrNoSubject ref added")

# ── 2. Add bmrSetAsSubject function (before bmrReset) ─────────────
old_reset_fn = "    function bmrReset(){"
new_reset_fn = """    function bmrSetAsSubject(i){
      // Swap comp[i] into subject slot, push old subject into comps (if it has an address)
      const cand = bmrAnalysis.value.comps[i];
      const oldSubj = Object.assign({}, bmrAnalysis.value.subject);
      bmrAnalysis.value.subject = Object.assign({}, cand);
      bmrAnalysis.value.comps.splice(i, 1);
      if (oldSubj.address && oldSubj.address.trim()) {
        bmrAnalysis.value.comps.unshift(oldSubj);
      }
      bmrNoSubject.value = false;
      bmrReportTitle.value = 'Market Report: ' + (cand.address || '');
    }
    function bmrReset(){"""
assert old_reset_fn in content, "bmrReset not found"
content = content.replace(old_reset_fn, new_reset_fn, 1)
print("2. bmrSetAsSubject function added")

# ── 3. Reset bmrNoSubject in bmrReset ────────────────────────────
old_reset_body = "bmrStep.value=1;bmrFile.value=null;bmrDragOver.value=false;bmrAnalysis.value=null;bmrClientName.value='';bmrOfferPrice.value='';bmrReportTitle.value='';bmrOfferTerms.value=[];bmrDisclaimerAck.value=false;bmrAnalyzing.value=false;bmrDeploying.value=false;bmrUploadError.value='';bmrDeployError.value='';bmrResult.value=null;bmrCopied.value=false;bmrQualityWarnings.value=[];bmrNExcluded.value=0;bmrLastRegen.value='';}"
new_reset_body = "bmrStep.value=1;bmrFile.value=null;bmrDragOver.value=false;bmrAnalysis.value=null;bmrClientName.value='';bmrOfferPrice.value='';bmrReportTitle.value='';bmrOfferTerms.value=[];bmrDisclaimerAck.value=false;bmrAnalyzing.value=false;bmrDeploying.value=false;bmrUploadError.value='';bmrDeployError.value='';bmrResult.value=null;bmrCopied.value=false;bmrQualityWarnings.value=[];bmrNExcluded.value=0;bmrLastRegen.value='';bmrNoSubject.value=false;}"
assert old_reset_body in content, "bmrReset body not found"
content = content.replace(old_reset_body, new_reset_body, 1)
print("3. bmrReset updated")

# ── 4. Expose bmrNoSubject + bmrSetAsSubject in return ────────────
old_return = "bmrStep,bmrFile,bmrDragOver,bmrAnalysis,bmrClientName,bmrOfferPrice,bmrReportTitle,bmrOfferTerms,bmrDisclaimerAck,bmrAnalyzing,bmrDeploying,bmrUploadError,bmrDeployError,bmrResult,bmrCopied,bmrTermOptions,bmrLsPillClass,bmrAnalyze,bmrDeploy,bmrCopyLink,bmrOpenEmail,bmrReset,bmrRegenerating,bmrRegenError,bmrRegenerate,bmrQualityWarnings,bmrNExcluded,bmrLastRegen,"
new_return  = "bmrStep,bmrFile,bmrDragOver,bmrAnalysis,bmrClientName,bmrOfferPrice,bmrReportTitle,bmrOfferTerms,bmrDisclaimerAck,bmrAnalyzing,bmrDeploying,bmrUploadError,bmrDeployError,bmrResult,bmrCopied,bmrTermOptions,bmrLsPillClass,bmrAnalyze,bmrDeploy,bmrCopyLink,bmrOpenEmail,bmrReset,bmrRegenerating,bmrRegenError,bmrRegenerate,bmrQualityWarnings,bmrNExcluded,bmrLastRegen,bmrNoSubject,bmrSetAsSubject,"
assert old_return in content, "return statement not found"
content = content.replace(old_return, new_return, 1)
print("4. return updated")

# ── 5. Add "No subject property" toggle + banner to Step 2 subject card ───
old_subject_card = """              <div class="card" style="padding:24px;margin-bottom:20px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
                  <h3 style="font-size:16px;font-weight:700;color:var(--navy);">Subject Property</h3>
                  <span style="font-size:11px;color:var(--muted);background:var(--bg);padding:4px 10px;border-radius:20px;border:1px solid var(--border);">Edit any field before proceeding</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
                  <div v-for="(fld,key) in {address:'Address',beds:'Beds',baths:'Baths',sqft:'Sq Ft',list_price:'List Price'}" :key="key">
                    <label style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px;">{{ fld }}</label>
                    <input class="form-input" v-model="bmrAnalysis.subject[key]" style="width:100%;">
                  </div>
                </div>
              </div>"""

new_subject_card = """              <div class="card" style="padding:24px;margin-bottom:20px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
                  <h3 style="font-size:16px;font-weight:700;color:var(--navy);margin:0;">Subject Property</h3>
                  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <span v-if="!bmrNoSubject" style="font-size:11px;color:var(--muted);background:var(--bg);padding:4px 10px;border-radius:20px;border:1px solid var(--border);">Edit any field before proceeding</span>
                    <button @click="bmrNoSubject=!bmrNoSubject"
                      :style="{fontSize:'11px',fontWeight:600,padding:'4px 12px',borderRadius:'20px',border:'1px solid',cursor:'pointer',background:bmrNoSubject?'#fef9c3':'var(--bg)',borderColor:bmrNoSubject?'#ca8a04':'var(--border)',color:bmrNoSubject?'#854d0e':'var(--muted)'}">
                      {{ bmrNoSubject ? '⚠ No subject selected' : 'No subject yet?' }}
                    </button>
                  </div>
                </div>
                <div v-if="bmrNoSubject" style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:14px 16px;margin-bottom:14px;">
                  <div style="font-weight:700;font-size:13px;color:#854d0e;margin-bottom:4px;">No subject property designated</div>
                  <div style="font-size:12px;color:#713f12;line-height:1.6;">The buyer is still evaluating options. Click <strong>▶ Use as Subject</strong> on any listing below to designate it as the property you're analyzing — the others will become comps.</div>
                </div>
                <div :style="{opacity:bmrNoSubject?0.4:'1',pointerEvents:bmrNoSubject?'none':'auto'}">
                  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
                    <div v-for="(fld,key) in {address:'Address',beds:'Beds',baths:'Baths',sqft:'Sq Ft',list_price:'List Price'}" :key="key">
                      <label style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:4px;">{{ fld }}</label>
                      <input class="form-input" v-model="bmrAnalysis.subject[key]" style="width:100%;">
                    </div>
                  </div>
                </div>
              </div>"""

assert old_subject_card in content, "Subject card not found"
content = content.replace(old_subject_card, new_subject_card, 1)
print("5. Subject card updated with no-subject toggle")

# ── 6. Add "Use as Subject" button to each comp card ──────────────
old_comp_header = """                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <span style="font-size:11px;font-weight:700;color:#fff;background:var(--navy);border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;">{{ i+1 }}</span>
                    <input class="form-input" v-model="comp.address" style="flex:1;font-weight:600;">
                    <button @click="bmrAnalysis.comps.splice(i,1)" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:16px;padding:0;">✕</button>
                  </div>"""

new_comp_header = """                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <span style="font-size:11px;font-weight:700;color:#fff;background:var(--navy);border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">{{ i+1 }}</span>
                    <input class="form-input" v-model="comp.address" style="flex:1;font-weight:600;min-width:0;">
                    <button v-if="bmrNoSubject" @click="bmrSetAsSubject(i)"
                      style="background:var(--navy);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;padding:5px 10px;cursor:pointer;white-space:nowrap;flex-shrink:0;">
                      ▶ Use as Subject
                    </button>
                    <button @click="bmrAnalysis.comps.splice(i,1)" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:16px;padding:0;flex-shrink:0;">✕</button>
                  </div>"""

assert old_comp_header in content, "Comp header not found"
content = content.replace(old_comp_header, new_comp_header, 1)
print("6. Comp cards updated with Use as Subject button")

# ── 7. Block "Continue to Offer Details" when no subject designated ──
old_continue_btn = '                <button class="btn-primary" style="flex:1;" @click="bmrStep=3">Continue to Offer Details →</button>'
new_continue_btn = '                <button class="btn-primary" style="flex:1;" :disabled="bmrNoSubject" :title="bmrNoSubject?\'Select a subject property first\':\'\'" @click="bmrStep=3">{{ bmrNoSubject ? "Select a subject property to continue" : "Continue to Offer Details →" }}</button>'
assert old_continue_btn in content, "Continue button not found"
content = content.replace(old_continue_btn, new_continue_btn, 1)
print("7. Continue button guarded")

assert content != original, "No changes made"
with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(content)
print("\nAll 7 changes applied successfully")
