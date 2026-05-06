with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    html = f.read()

# ═══════════════════════════════════════════════════════════════════════════════
# 1. FIX ADDRESS EDIT — make it inline in MLS section (no scroll-to-top nonsense)
# ═══════════════════════════════════════════════════════════════════════════════

# Add mlsEditingAddress ref near lstEditingAddress
old_edit_ref = "    const lstEditingAddress = ref(false);\n    const lstEditAddressVal = ref('');"
new_edit_ref = ("    const lstEditingAddress = ref(false);\n"
                "    const lstEditAddressVal = ref('');\n"
                "    const mlsEditingAddress = ref(false);\n"
                "    const mlsEditAddressVal = ref('');")
assert old_edit_ref in html, "lstEditingAddress ref not found"
html = html.replace(old_edit_ref, new_edit_ref, 1)

# Add mlsEditingAddress to setup() return
old_ret_edit = "      lstEditingAddress, lstEditAddressVal, lstSaveAddress, lstNormalizeAddress,"
new_ret_edit = "      lstEditingAddress, lstEditAddressVal, lstSaveAddress, lstNormalizeAddress, mlsEditingAddress, mlsEditAddressVal,"
assert old_ret_edit in html, "lstEditingAddress return not found"
html = html.replace(old_ret_edit, new_ret_edit, 1)

# Replace the MLS address display+edit button with a self-contained inline edit
old_mls_addr_box = """                    <div class="form-row">
                      <label>Property Address</label>
                      <div style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:1;font-family:'Cormorant Garamond',serif;font-size:14px;color:var(--navy);padding:9px 12px;background:var(--white);border:1px solid var(--cream-mid);border-radius:2px;line-height:1.3;">{{ lstActiveProp.address || '—' }}</div>
                        <button @click="lstEditingAddress=true;lstEditAddressVal=lstActiveProp.address;window.scrollTo({top:0,behavior:'smooth'})" style="background:none;border:none;font-family:'Montserrat',sans-serif;font-size:7px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold-muted);cursor:pointer;white-space:nowrap;padding:0;">Edit ✎</button>
                      </div>
                    </div>"""
new_mls_addr_box = """                    <div class="form-row">
                      <label>Property Address</label>
                      <div v-if="!mlsEditingAddress" style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:1;font-family:'Cormorant Garamond',serif;font-size:14px;color:var(--navy);padding:9px 12px;background:var(--white);border:1px solid var(--cream-mid);border-radius:2px;line-height:1.3;">{{ lstActiveProp.address || '—' }}</div>
                        <button @click="mlsEditingAddress=true;mlsEditAddressVal=lstActiveProp.address" style="background:none;border:none;font-family:'Montserrat',sans-serif;font-size:7px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold-muted);cursor:pointer;white-space:nowrap;padding:0;">Edit ✎</button>
                      </div>
                      <div v-else>
                        <input v-model="mlsEditAddressVal" @keyup.enter="lstSaveAddress();mlsEditingAddress=false" @keyup.escape="mlsEditingAddress=false" style="width:100%;box-sizing:border-box;font-family:'Cormorant Garamond',serif;font-size:14px;padding:9px 12px;border:1px solid var(--gold-muted);border-radius:2px;outline:none;color:var(--navy);background:var(--white);margin-bottom:6px;">
                        <div style="display:flex;gap:8px;">
                          <button class="btn-gold" @click="lstEditAddressVal=mlsEditAddressVal;lstSaveAddress();mlsEditingAddress=false" style="flex:1;padding:7px;font-size:8px;">Save</button>
                          <button @click="mlsEditingAddress=false" style="flex:1;padding:7px;background:none;border:1px solid var(--cream-dark);border-radius:2px;font-family:'Montserrat',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--navy);cursor:pointer;">Cancel</button>
                        </div>
                      </div>
                    </div>"""
assert old_mls_addr_box in html, "MLS address box not found"
html = html.replace(old_mls_addr_box, new_mls_addr_box, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 2. FIX LD AUTO-INJECT ORDER — combine address + MLS into ONE message
# ═══════════════════════════════════════════════════════════════════════════════

old_inject = """        ldMessages.value.push({ role:'assistant', content: reply });
        // Auto-send address + any saved MLS data — skip questions we already have answers for
        if (lstActiveProp.value && lstActiveProp.value.address) {
          await nextTick();
          await ldSend(lstActiveProp.value.address);
          // Now auto-inject MLS data if the form has the key fields filled
          const _mf = mlsForm;
          const _parts = [];
          if (_mf.beds)      _parts.push(_mf.beds + ' bed' + (_mf.beds === '1' ? '' : 's'));
          if (_mf.baths)     _parts.push(_mf.baths + ' bath' + (_mf.baths === '1' ? '' : 's'));
          if (_mf.sqft)      _parts.push(_mf.sqft + ' sq ft');
          if (_mf.listPrice) _parts.push('listed at ' + _mf.listPrice);
          if (_mf.propType)  _parts.push('property type: ' + _mf.propType);
          if (_mf.yearBuilt) _parts.push('year built: ' + _mf.yearBuilt);
          if (_mf.hoa)       _parts.push('HOA: ' + _mf.hoa);
          if (_mf.parking)   _parts.push('parking: ' + _mf.parking);
          const _features = (_mf.features || []).filter(f => f && f.trim());
          if (_features.length) _parts.push('key features: ' + _features.join(', '));
          if (_parts.length >= 3) {
            // We have enough data to skip the details question
            await ldSend(_parts.join(', '));
          }
          return;
        }"""

new_inject = """        ldMessages.value.push({ role:'assistant', content: reply });
        // Auto-send address + any saved MLS data in ONE combined message
        if (lstActiveProp.value && lstActiveProp.value.address) {
          await nextTick();
          const _mf = mlsForm;
          const _parts = [];
          if (_mf.beds)      _parts.push(_mf.beds + ' bed' + (_mf.beds === '1' ? '' : 's'));
          if (_mf.baths)     _parts.push(_mf.baths + ' bath' + (_mf.baths === '1' ? '' : 's'));
          if (_mf.sqft)      _parts.push(_mf.sqft + ' sq ft');
          if (_mf.listPrice) _parts.push('listed at ' + _mf.listPrice);
          if (_mf.propType)  _parts.push('property type: ' + _mf.propType);
          if (_mf.yearBuilt) _parts.push('year built: ' + _mf.yearBuilt);
          if (_mf.hoa)       _parts.push('HOA: ' + _mf.hoa);
          if (_mf.parking)   _parts.push('parking: ' + _mf.parking);
          const _features = (_mf.features || []).filter(f => f && f.trim());
          if (_features.length) _parts.push('key features: ' + _features.join(', '));
          // Build single combined message so Claude receives everything at once
          let _autoMsg = 'Property address: ' + lstActiveProp.value.address + '. Please also research whether this address is a notable, named, or luxury building (e.g. a branded residence, historic landmark, or recognizable development) and mention it prominently if so.';
          if (_parts.length >= 3) {
            _autoMsg += ' I also have the following property details already: ' + _parts.join(', ') + '. Please skip any questions you already have the answers to and continue from where you still need information.';
          }
          await ldSend(_autoMsg);
          return;
        }"""

assert old_inject in html, "LD inject block not found"
html = html.replace(old_inject, new_inject, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 3. GLOBAL ACTIVITY INDICATOR — banner when any background work is running
# ═══════════════════════════════════════════════════════════════════════════════

# Add CSS for the activity bar
old_subfolder_css = ".subfolder-panel { border-bottom: 1px solid var(--cream-mid); }"
new_subfolder_css = """.subfolder-panel { border-bottom: 1px solid var(--cream-mid); }

/* ── ACTIVITY BAR ── */
.activity-bar {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 8500;
  background: var(--navy); color: var(--gold);
  display: flex; align-items: center; gap: 10px;
  padding: 9px 18px; font-family: 'Montserrat', sans-serif;
  font-size: 8px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
  box-shadow: 0 -2px 12px rgba(10,35,66,0.18);
  animation: slideUpIn 0.25s ease;
}
@keyframes slideUpIn { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.activity-bar .act-spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid rgba(200,169,76,0.25); border-top-color: var(--gold);
  animation: spin 0.8s linear infinite; flex-shrink: 0;
}"""
assert old_subfolder_css in html, "subfolder-panel CSS not found"
html = html.replace(old_subfolder_css, new_subfolder_css, 1)

# Add activity bar HTML before closing </div> of the app root
# Find the global New Property Modal and add the activity bar right before it
old_activity_anchor = "    <!-- New Property Modal (global) -->"
new_activity_anchor = """    <!-- Global Activity Bar -->
    <div v-if="activityLabel" class="activity-bar">
      <span class="act-spinner"></span>
      <span>{{ activityLabel }}</span>
    </div>

    <!-- New Property Modal (global) -->"""
assert old_activity_anchor in html, "activity anchor not found"
html = html.replace(old_activity_anchor, new_activity_anchor, 1)

# Add activityLabel computed ref in JS (after lstNewSeller ref)
old_activity_js = "    const lstNewMarket  = ref('DC');"
new_activity_js = """    const lstNewMarket  = ref('DC');

    // ── Global activity indicator ──────────────────────────────────────────
    const activityLabel = computed(() => {
      if (lstCreating.value)  return 'Creating property…';
      if (mlsSaving.value)    return 'Saving MLS data…';
      if (ldLoading.value)    return 'Writing listing description…';
      if (ldSaving.value)     return 'Saving description to property…';
      if (Object.values(lstUploading).some(Boolean))  return 'Uploading file…';
      if (Object.values(byrUploading || {}).some(Boolean)) return 'Uploading file…';
      if (lstSubmitting.value) return 'Submitting to FORWARD pipeline…';
      if (lstDeleting.value)  return 'Deleting property…';
      return null;
    });"""
assert old_activity_js in html, "lstNewMarket ref not found for activity js"
html = html.replace(old_activity_js, new_activity_js, 1)

# Add activityLabel to setup() return
old_ret_activity = "      mlsForm, mlsSaving, mlsGate, mlsSaveManual, mlsFormatPrice, mlsFormatSqft, lstOpenTool,"
new_ret_activity = "      mlsForm, mlsSaving, mlsGate, mlsSaveManual, mlsFormatPrice, mlsFormatSqft, lstOpenTool, activityLabel,"
assert old_ret_activity in html, "mlsForm return not found"
html = html.replace(old_ret_activity, new_ret_activity, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 4. FIX "NO LISTING DESCRIPTION" — show saved file when note text isn't loaded
# ═══════════════════════════════════════════════════════════════════════════════

old_ld_display = """                  <!-- Saved listing description recall -->
                  <div v-if="lstNotes.listing_remarks" style="background:var(--cream);border:1px solid var(--cream-mid);border-radius:2px;padding:14px;margin-bottom:14px;">
                    <div style="font-family:'Montserrat',sans-serif;font-size:8px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:0.18em;margin-bottom:10px;">Saved Listing Description</div>
                    <div style="font-family:'Cormorant Garamond',serif;font-size:14px;color:var(--navy);background:var(--white);border:1px solid var(--cream-mid);border-radius:2px;padding:12px;max-height:200px;overflow-y:auto;white-space:pre-wrap;line-height:1.65;">{{ lstNotes.listing_remarks }}</div>
                    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
                      <button class="btn-sm btn-navy" @click="copy(lstNotes.listing_remarks)">Copy</button>
                      <button class="btn-sm" style="background:var(--white);border:1px solid var(--cream-dark);color:var(--navy);font-family:'Montserrat',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;" @click="view='listing-desc'">Edit in Writer</button>
                    </div>
                  </div>
                  <!-- Drive file links -->
                  <div v-if="lstSubfolderFiles('listing_remarks').length > 0" style="margin-bottom:14px;">
                    <div style="font-family:'Montserrat',sans-serif;font-size:7.5px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:0.18em;margin-bottom:8px;opacity:0.55;">Saved Files</div>
                    <div v-for="file in lstSubfolderFiles('listing_remarks')" :key="file.id" style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--white);border:1px solid var(--cream-mid);border-radius:2px;margin-bottom:4px;">
                      <span style="font-family:'Cormorant Garamond',serif;font-size:13px;color:var(--navy);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ file.file_name }}</span>
                      <a v-if="file.drive_link" :href="file.drive_link" target="_blank" style="font-family:'Montserrat',sans-serif;font-size:7.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--navy);text-decoration:none;white-space:nowrap;flex-shrink:0;border:1px solid var(--cream-dark);padding:4px 10px;border-radius:2px;">View →</a>
                      <button @click="lstDeleteFile(file)" class="btn-del" title="Delete">✕</button>
                    </div>
                  </div>"""

new_ld_display = """                  <!-- Saved listing description recall -->
                  <div v-if="lstNotes.listing_remarks || lstSubfolderFiles('listing_remarks').length > 0" style="background:var(--cream);border:1px solid var(--cream-mid);border-radius:2px;padding:14px;margin-bottom:14px;">
                    <div style="font-family:'Montserrat',sans-serif;font-size:8px;font-weight:700;color:var(--gold);text-transform:uppercase;letter-spacing:0.18em;margin-bottom:10px;">Saved Listing Description</div>
                    <!-- Text content if loaded -->
                    <div v-if="lstNotes.listing_remarks" style="font-family:'Cormorant Garamond',serif;font-size:14px;color:var(--navy);background:var(--white);border:1px solid var(--cream-mid);border-radius:2px;padding:12px;max-height:200px;overflow-y:auto;white-space:pre-wrap;line-height:1.65;margin-bottom:10px;">{{ lstNotes.listing_remarks }}</div>
                    <!-- File links -->
                    <div v-for="file in lstSubfolderFiles('listing_remarks')" :key="file.id" style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:var(--white);border:1px solid var(--cream-mid);border-radius:2px;margin-bottom:4px;">
                      <span style="font-family:'Cormorant Garamond',serif;font-size:13px;color:var(--navy);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ file.file_name }}</span>
                      <a v-if="file.drive_link" :href="file.drive_link" target="_blank" style="font-family:'Montserrat',sans-serif;font-size:7.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--navy);text-decoration:none;white-space:nowrap;flex-shrink:0;border:1px solid var(--cream-dark);padding:4px 10px;border-radius:2px;">View →</a>
                      <button @click="lstDeleteFile(file)" class="btn-del" title="Delete">✕</button>
                    </div>
                    <!-- If file saved but text not in memory, show note -->
                    <div v-if="!lstNotes.listing_remarks && lstSubfolderFiles('listing_remarks').length > 0" style="font-family:'Cormorant Garamond',serif;font-size:13px;color:#6b7280;font-style:italic;margin-bottom:8px;">Description saved as file above. Open the Writer to generate a new version.</div>
                    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
                      <button v-if="lstNotes.listing_remarks" class="btn-sm btn-navy" @click="copy(lstNotes.listing_remarks)">Copy</button>
                      <button class="btn-sm" style="background:var(--white);border:1px solid var(--cream-dark);color:var(--navy);font-family:'Montserrat',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;" @click="view='listing-desc'">{{ lstNotes.listing_remarks ? 'Edit in Writer' : 'Open Writer' }}</button>
                    </div>
                  </div>"""

assert old_ld_display in html, "LD display block not found"
html = html.replace(old_ld_display, new_ld_display, 1)

with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(html)

print("All five fixes applied.")
