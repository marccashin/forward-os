with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    html = f.read()

# ═══════════════════════════════════════════════════════════════════════════════
# 1. FIX SWIPE — add touchmove handler to prevent page scroll during horizontal swipe
# ═══════════════════════════════════════════════════════════════════════════════

# HTML: remove .passive, add touchmove
old_sw_html = '@touchstart.passive="fileTouchStart($event, file.id)" @touchend.passive="fileTouchEnd($event, file.id)"'
new_sw_html = '@touchstart="fileTouchStart($event, file.id)" @touchmove.prevent="fileTouchMove($event)" @touchend="fileTouchEnd($event, file.id)"'
assert old_sw_html in html, "swipe touch handlers not found"
html = html.replace(old_sw_html, new_sw_html, 1)

# JS: update fileTouchStart to track Y, add fileTouchMove, update return value list
old_sw_js = "    const fileSwipedId = ref(null);\n    let _fileTouchStartX = 0, _fileTouchCardId = null;\n    function fileTouchStart(e, id) { _fileTouchStartX = e.touches[0].clientX; _fileTouchCardId = id; }\n    function fileTouchEnd(e, id) {\n      if (_fileTouchCardId !== id) return;\n      const dx = e.changedTouches[0].clientX - _fileTouchStartX;\n      if (dx < -50) fileSwipedId.value = id;\n      else if (dx > 30) { if (fileSwipedId.value === id) fileSwipedId.value = null; }\n      _fileTouchCardId = null;"
new_sw_js = "    const fileSwipedId = ref(null);\n    let _fileTouchStartX = 0, _fileTouchStartY = 0, _fileTouchCardId = null, _fileTouchIsH = false;\n    function fileTouchStart(e, id) { _fileTouchStartX = e.touches[0].clientX; _fileTouchStartY = e.touches[0].clientY; _fileTouchCardId = id; _fileTouchIsH = false; }\n    function fileTouchMove(e) {\n      const dx = Math.abs(e.touches[0].clientX - _fileTouchStartX);\n      const dy = Math.abs(e.touches[0].clientY - _fileTouchStartY);\n      if (dx > dy && dx > 8) _fileTouchIsH = true;\n      if (!_fileTouchIsH) { e.stopPropagation(); return; }\n    }\n    function fileTouchEnd(e, id) {\n      if (_fileTouchCardId !== id) return;\n      const dx = e.changedTouches[0].clientX - _fileTouchStartX;\n      if (dx < -50) fileSwipedId.value = id;\n      else if (dx > 30) { if (fileSwipedId.value === id) fileSwipedId.value = null; }\n      _fileTouchCardId = null; _fileTouchIsH = false;"
assert old_sw_js in html, "fileTouchStart JS block not found"
html = html.replace(old_sw_js, new_sw_js, 1)

# Update return list to include fileTouchMove
old_ret = "      fileSwipedId, fileTouchStart, fileTouchEnd,"
new_ret = "      fileSwipedId, fileTouchStart, fileTouchMove, fileTouchEnd,"
assert old_ret in html, "fileTouchEnd return not found"
html = html.replace(old_ret, new_ret, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 2. ADD REFS for new property modal fields
# ═══════════════════════════════════════════════════════════════════════════════

old_refs = "    const lstNewAddress = ref('');\n    const lstNewMarket = ref('DC');"
new_refs = ("    const lstNewAddress = ref('');\n"
            "    const lstNewStreet  = ref('');\n"
            "    const lstNewUnit    = ref('');\n"
            "    const lstNewCity    = ref('');\n"
            "    const lstNewState   = ref('');\n"
            "    const lstNewZip     = ref('');\n"
            "    const lstNewSeller  = ref('');\n"
            "    const lstNewMarket  = ref('DC');")
assert old_refs in html, "lstNewAddress/lstNewMarket refs not found"
html = html.replace(old_refs, new_refs, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 3. UPDATE lstCreateProperty to compose address from new fields + add seller_name
# ═══════════════════════════════════════════════════════════════════════════════

old_create_guard = "    async function lstCreateProperty() {\n      if (!lstNewAddress.value.trim()) return;"
new_create_guard = ("    async function lstCreateProperty() {\n"
                    "      // Compose address from structured fields (or fall back to lstNewAddress)\n"
                    "      if (lstNewStreet.value.trim()) {\n"
                    "        const parts = [lstNewStreet.value.trim()];\n"
                    "        if (lstNewUnit.value.trim()) parts.push('Unit ' + lstNewUnit.value.trim());\n"
                    "        const cityStateZip = [lstNewCity.value.trim(), lstNewState.value.trim(), lstNewZip.value.trim()].filter(Boolean).join(' ');\n"
                    "        if (cityStateZip) parts.push(cityStateZip);\n"
                    "        lstNewAddress.value = parts.join(', ');\n"
                    "      }\n"
                    "      if (!lstNewAddress.value.trim()) return;")
assert old_create_guard in html, "lstCreateProperty guard not found"
html = html.replace(old_create_guard, new_create_guard, 1)

# Add seller_name to the propData insert
old_propdata = ("        const propData = {\n"
                "          address: lstNormalizeAddress(lstNewAddress.value),\n"
                "          agent_email: sessionEmail.value,\n"
                "          agent_name: agentName.value,\n"
                "          market: lstNewMarket.value,\n"
                "          status: 'draft',\n"
                "          drive_folder_id: '',\n"
                "          subfolder_drive_ids: {}\n"
                "        };")
new_propdata = ("        const propData = {\n"
                "          address: lstNormalizeAddress(lstNewAddress.value),\n"
                "          agent_email: sessionEmail.value,\n"
                "          agent_name: agentName.value,\n"
                "          seller_name: lstNewSeller.value.trim(),\n"
                "          market: lstNewMarket.value,\n"
                "          status: 'draft',\n"
                "          drive_folder_id: '',\n"
                "          subfolder_drive_ids: {}\n"
                "        };")
assert old_propdata in html, "propData insert not found"
html = html.replace(old_propdata, new_propdata, 1)

# Reset new fields after modal close
old_reset = ("        lstShowNewModal.value = false;\n"
             "        lstNewAddress.value = '';\n"
             "        lstNewMarket.value = 'DC';")
new_reset = ("        lstShowNewModal.value = false;\n"
             "        lstNewAddress.value = ''; lstNewStreet.value = ''; lstNewUnit.value = '';\n"
             "        lstNewCity.value = ''; lstNewState.value = ''; lstNewZip.value = '';\n"
             "        lstNewSeller.value = ''; lstNewMarket.value = 'DC';")
assert old_reset in html, "lstNewAddress reset not found"
html = html.replace(old_reset, new_reset, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 4. UPDATE setup() return to expose new refs
# ═══════════════════════════════════════════════════════════════════════════════

old_ret2 = "lstProperties, lstLoading, lstToolOpen, photoLightbox, openPhotoLightbox, photoLightboxNav, downloadAllPhotos, lstPkgMovedBanner, lstDismissPkgBanner, lstShowNewModal, lstNewAddress, lstNewMarket,"
new_ret2 = "lstProperties, lstLoading, lstToolOpen, photoLightbox, openPhotoLightbox, photoLightboxNav, downloadAllPhotos, lstPkgMovedBanner, lstDismissPkgBanner, lstShowNewModal, lstNewAddress, lstNewStreet, lstNewUnit, lstNewCity, lstNewState, lstNewZip, lstNewSeller, lstNewMarket,"
assert old_ret2 in html, "setup return lstNewAddress not found"
html = html.replace(old_ret2, new_ret2, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 5. REPLACE the New Property Modal HTML with full structured form
# ═══════════════════════════════════════════════════════════════════════════════

old_modal = '''    <!-- New Property Modal (global) -->
    <div v-if="lstShowNewModal" style="position:fixed;inset:0;background:rgba(10,35,66,0.72);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;" @click.self="lstShowNewModal=false">
      <div style="background:var(--white);border:1px solid var(--cream-mid);border-radius:2px;width:100%;max-width:420px;padding:28px 24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div style="font-family:\'Cormorant Garamond\',serif;font-size:22px;font-weight:500;color:var(--navy);">New Property</div>
          <button @click="lstShowNewModal=false" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--navy);opacity:0.4;line-height:1;">✕</button>
        </div>
        <div style="margin-bottom:14px;">
          <div style="font-family:\'Montserrat\',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--navy);margin-bottom:6px;">Address</div>
          <input v-model="lstNewAddress" placeholder="e.g. 1234 Oak St NW, Washington DC 20010" @keyup.enter="lstCreateProperty" style="width:100%;box-sizing:border-box;font-family:\'Cormorant Garamond\',serif;font-size:14px;padding:10px 12px;border:1px solid var(--cream-dark);border-radius:2px;color:var(--navy);background:var(--cream);outline:none;">
        </div>
        <div style="margin-bottom:20px;">
          <div style="font-family:\'Montserrat\',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--navy);margin-bottom:6px;">Market</div>
          <select v-model="lstNewMarket" style="width:100%;box-sizing:border-box;font-family:\'Montserrat\',sans-serif;font-size:9px;font-weight:600;padding:10px 12px;border:1px solid var(--cream-dark);border-radius:2px;color:var(--navy);background:var(--cream);outline:none;">
            <option value="DC">Washington DC</option>
            <option value="MD">Maryland</option>
            <option value="VA">Virginia</option>
          </select>
        </div>
        <div v-if="lstCreateError" style="font-family:\'Montserrat\',sans-serif;font-size:8.5px;color:#dc2626;margin-bottom:12px;letter-spacing:0.04em;">{{ lstCreateError }}</div>
        <button @click="lstCreateProperty" :disabled="lstCreating||!lstNewAddress.trim()" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--navy);color:var(--gold);border:none;border-radius:2px;font-family:\'Montserrat\',sans-serif;font-size:9px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;padding:13px;cursor:pointer;transition:opacity 0.13s;" :style="{opacity:(lstCreating||!lstNewAddress.trim())?\'0.45\':\'1\'}">
          <span v-if="lstCreating" style="display:inline-flex;gap:4px;align-items:center;">
            <span style="width:6px;height:6px;border-radius:50%;background:var(--gold);display:inline-block;animation:aiDot 1.2s ease-in-out infinite;"></span>
            <span style="width:6px;height:6px;border-radius:50%;background:var(--gold);display:inline-block;animation:aiDot 1.2s ease-in-out 0.2s infinite;"></span>
            <span style="width:6px;height:6px;border-radius:50%;background:var(--gold);display:inline-block;animation:aiDot 1.2s ease-in-out 0.4s infinite;"></span>
          </span>
          <span>{{ lstCreating ? \'Creating…\' : \'Create Property\' }}</span>
        </button>
      </div>
    </div>'''

new_modal = '''    <!-- New Property Modal (global) -->
    <div v-if="lstShowNewModal" style="position:fixed;inset:0;background:rgba(10,35,66,0.72);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;" @click.self="lstShowNewModal=false">
      <div style="background:var(--white);border:1px solid var(--cream-mid);border-radius:2px;width:100%;max-width:420px;padding:28px 24px;margin:auto;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div style="font-family:\'Cormorant Garamond\',serif;font-size:22px;font-weight:500;color:var(--navy);">New Property</div>
          <button @click="lstShowNewModal=false" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--navy);opacity:0.4;line-height:1;">✕</button>
        </div>

        <!-- Street address -->
        <div class="form-row" style="margin-bottom:10px;">
          <label>Street Address</label>
          <input v-model="lstNewStreet" placeholder="e.g. 1234 Oak St NW" style="width:100%;box-sizing:border-box;" @keyup.enter="lstCreateProperty">
        </div>

        <!-- Unit -->
        <div class="form-row" style="margin-bottom:10px;">
          <label>Unit / Apt <span style="font-weight:400;opacity:0.5;font-size:9px;">(optional)</span></label>
          <input v-model="lstNewUnit" placeholder="e.g. #4B" style="width:100%;box-sizing:border-box;">
        </div>

        <!-- City + State in one row -->
        <div style="display:grid;grid-template-columns:1fr 90px;gap:10px;margin-bottom:10px;">
          <div class="form-row">
            <label>City</label>
            <input v-model="lstNewCity" placeholder="Washington" style="width:100%;box-sizing:border-box;">
          </div>
          <div class="form-row">
            <label>State</label>
            <input v-model="lstNewState" placeholder="DC" maxlength="2" style="width:100%;box-sizing:border-box;text-transform:uppercase;" @input="lstNewState=lstNewState.toUpperCase()">
          </div>
        </div>

        <!-- Zip + Market in one row -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div class="form-row">
            <label>Zip Code</label>
            <input v-model="lstNewZip" placeholder="20010" inputmode="numeric" maxlength="10" style="width:100%;box-sizing:border-box;">
          </div>
          <div class="form-row">
            <label>Market</label>
            <select v-model="lstNewMarket" style="width:100%;box-sizing:border-box;font-family:\'Montserrat\',sans-serif;font-size:9px;font-weight:600;padding:10px 12px;border:1px solid var(--cream-dark);border-radius:2px;color:var(--navy);background:var(--cream);outline:none;">
              <option value="DC">DC</option>
              <option value="MD">Maryland</option>
              <option value="VA">Virginia</option>
            </select>
          </div>
        </div>

        <!-- Seller name -->
        <div class="form-row" style="margin-bottom:20px;">
          <label>Seller Name</label>
          <input v-model="lstNewSeller" placeholder="e.g. John & Jane Smith" style="width:100%;box-sizing:border-box;" @keyup.enter="lstCreateProperty">
        </div>

        <div v-if="lstCreateError" style="font-family:\'Montserrat\',sans-serif;font-size:8.5px;color:#dc2626;margin-bottom:12px;letter-spacing:0.04em;">{{ lstCreateError }}</div>
        <button @click="lstCreateProperty" :disabled="lstCreating||!lstNewStreet.trim()" style="display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:var(--navy);color:var(--gold);border:none;border-radius:2px;font-family:\'Montserrat\',sans-serif;font-size:9px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;padding:13px;cursor:pointer;transition:opacity 0.13s;" :style="{opacity:(lstCreating||!lstNewStreet.trim())?\'0.45\':\'1\'}">
          <span v-if="lstCreating" style="display:inline-flex;gap:4px;align-items:center;">
            <span style="width:6px;height:6px;border-radius:50%;background:var(--gold);display:inline-block;animation:aiDot 1.2s ease-in-out infinite;"></span>
            <span style="width:6px;height:6px;border-radius:50%;background:var(--gold);display:inline-block;animation:aiDot 1.2s ease-in-out 0.2s infinite;"></span>
            <span style="width:6px;height:6px;border-radius:50%;background:var(--gold);display:inline-block;animation:aiDot 1.2s ease-in-out 0.4s infinite;"></span>
          </span>
          <span>{{ lstCreating ? \'Creating…\' : \'Create Property\' }}</span>
        </button>
      </div>
    </div>'''

assert old_modal in html, "New Property Modal HTML not found"
html = html.replace(old_modal, new_modal, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 6. MAKE PROPERTY ADDRESS EDITABLE — replace readonly MLS Data address input
#    with a note pointing to "Edit address" above
# ═══════════════════════════════════════════════════════════════════════════════

old_mls_addr = '''                    <div class="form-row">
                      <label>Property Address <span style="font-size:10px;color:#9ca3af;">(from property folder)</span></label>
                      <input :value="lstActiveProp.address" readonly style="background:#f9fafb;color:#111;font-weight:500;cursor:default;">
                    </div>'''

new_mls_addr = '''                    <div class="form-row">
                      <label>Property Address</label>
                      <div style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:1;font-family:\'Cormorant Garamond\',serif;font-size:14px;color:var(--navy);padding:9px 12px;background:var(--white);border:1px solid var(--cream-mid);border-radius:2px;line-height:1.3;">{{ lstActiveProp.address || '—' }}</div>
                        <button @click="lstEditingAddress=true;lstEditAddressVal=lstActiveProp.address" style="background:none;border:none;font-family:\'Montserrat\',sans-serif;font-size:7px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold-muted);cursor:pointer;white-space:nowrap;padding:0;">Edit ✎</button>
                      </div>
                    </div>'''

assert old_mls_addr in html, "MLS address input not found"
html = html.replace(old_mls_addr, new_mls_addr, 1)

with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(html)

print("All changes applied successfully.")
