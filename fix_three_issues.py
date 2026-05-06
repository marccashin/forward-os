with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    html = f.read()

# ═══════════════════════════════════════════════════════════════════════════════
# 1. ADD PROPERTY DELETE CONFIRMATION MODAL
# ═══════════════════════════════════════════════════════════════════════════════
old1 = "        <template v-else-if=\"view==='listings'\">\n          <!-- Page header -->"
new1 = """        <template v-else-if="view==='listings'">
          <!-- Property delete confirmation modal -->
          <div v-if="lstDeleteTarget" style="position:fixed;inset:0;background:rgba(10,35,66,0.72);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;" @click.self="lstDeleteTarget=null">
            <div style="background:var(--white);border:1px solid var(--cream-mid);border-radius:2px;width:100%;max-width:380px;padding:28px 24px;text-align:center;">
              <div style="font-family:'Montserrat',sans-serif;font-size:7px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold-muted);margin-bottom:16px;">Delete Property</div>
              <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:500;color:var(--navy);margin-bottom:8px;">{{ lstDeleteTarget.address }}</div>
              <p style="font-family:'Cormorant Garamond',serif;font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.5;">This will permanently remove the property and all associated data. This cannot be undone.</p>
              <div style="display:flex;gap:10px;">
                <button @click="lstDeleteTarget=null" style="flex:1;background:none;border:1px solid var(--cream-dark);border-radius:2px;font-family:'Montserrat',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--navy);padding:11px;cursor:pointer;">Cancel</button>
                <button @click="lstDeleteProperty" :disabled="lstDeleting" style="flex:1;background:#b91c1c;border:none;border-radius:2px;font-family:'Montserrat',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#fff;padding:11px;cursor:pointer;transition:opacity 0.13s;" :style="{opacity:lstDeleting?'0.5':'1'}">
                  <span v-if="lstDeleting" class="spinner" style="border-color:rgba(255,255,255,0.3);border-top-color:#fff;"></span>{{ lstDeleting ? '' : 'Delete Property' }}
                </button>
              </div>
            </div>
          </div>
          <!-- Page header -->"""
assert old1 in html, "listings view start not found"
html = html.replace(old1, new1, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 2. REDESIGN PROPERTY HEADER — clean stacked mobile layout
# ═══════════════════════════════════════════════════════════════════════════════
old2 = """          <!-- Property header card -->
          <div class="prop-detail-header">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">
              <div style="flex:1;min-width:0;">
                <div v-if="!lstEditingAddress">
                  <div class="prop-detail-address">{{ lstActiveProp.address }}</div>
                  <button @click="lstEditingAddress=true;lstEditAddressVal=lstActiveProp.address" style="background:none;border:none;font-size:7.5px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold-muted);cursor:pointer;padding:0;margin-top:3px;">Edit address</button>
                </div>
                <div v-else style="display:flex;gap:8px;align-items:center;">
                  <input v-model="lstEditAddressVal" @keyup.enter="lstSaveAddress" @keyup.escape="lstEditingAddress=false" style="flex:1;font-family:'Cormorant Garamond',serif;font-size:18px;padding:4px 8px;border:1px solid var(--gold-muted);border-radius:1px;outline:none;color:var(--navy);">
                  <button class="btn-gold" @click="lstSaveAddress" style="font-size:8px;padding:6px 14px;white-space:nowrap;">Save</button>
                  <button class="btn-outline" @click="lstEditingAddress=false" style="font-size:8px;padding:6px 10px;">Cancel</button>
                </div>
                <div class="prop-detail-meta" style="margin-top:6px;">{{ lstActiveProp.agent_name || agentName }} · {{ lstActiveProp.market || 'DC' }} · Created {{ new Date(lstActiveProp.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) }}</div>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;margin-top:4px;">
                <input :value="lstActiveProp.seller_name || ''" @blur="lstSaveSellerName($event.target.value)" @keyup.enter="lstSaveSellerName($event.target.value)" placeholder="Seller name" style="font-family:'Montserrat',sans-serif;font-size:9px;padding:6px 12px;border:1px solid var(--cream-dark);border-radius:1px;color:var(--navy);outline:none;background:var(--cream);width:150px;">
                <span :class="'status-badge status-'+(lstActiveProp.status||'draft')">{{ lstActiveProp.status || 'draft' }}</span>
              </div>
            </div>
            <!-- Completion bar -->
            <div class="prop-completion-row">
              <span class="prop-completion-label">Asset Completion</span>
              <div class="progress-bar-track"><div class="progress-bar-fill" :style="{width:(lstAssetCount/5*100)+'%'}"></div></div>
              <span class="prop-completion-pct">{{ lstAssetCount }}/5 folders</span>
            </div>
          </div>"""
new2 = """          <!-- Property header card -->
          <div class="prop-detail-header">
            <!-- Address display or edit -->
            <div v-if="!lstEditingAddress" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
              <div class="prop-detail-address" style="flex:1;min-width:0;">{{ lstActiveProp.address }}</div>
              <button @click="lstEditingAddress=true;lstEditAddressVal=lstActiveProp.address" style="background:none;border:none;font-family:'Montserrat',sans-serif;font-size:7px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold-muted);cursor:pointer;padding:2px 0 0;white-space:nowrap;flex-shrink:0;">Edit ✎</button>
            </div>
            <div v-else style="margin-bottom:10px;">
              <input v-model="lstEditAddressVal" @keyup.enter="lstSaveAddress" @keyup.escape="lstEditingAddress=false" style="width:100%;box-sizing:border-box;font-family:'Cormorant Garamond',serif;font-size:16px;padding:8px 10px;border:1px solid var(--gold-muted);border-radius:2px;outline:none;color:var(--navy);background:var(--white);margin-bottom:8px;">
              <div style="display:flex;gap:8px;">
                <button class="btn-gold" @click="lstSaveAddress" style="flex:1;padding:8px;font-size:8px;">Save Address</button>
                <button @click="lstEditingAddress=false" style="flex:1;padding:8px;background:none;border:1px solid var(--cream-dark);border-radius:2px;font-family:'Montserrat',sans-serif;font-size:8px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--navy);cursor:pointer;">Cancel</button>
              </div>
            </div>
            <!-- Seller name + status -->
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <input :value="lstActiveProp.seller_name || ''" @blur="lstSaveSellerName($event.target.value)" @keyup.enter="lstSaveSellerName($event.target.value)" placeholder="+ Seller name" style="flex:1;min-width:0;font-family:'Montserrat',sans-serif;font-size:9px;padding:5px 10px;border:1px solid var(--cream-dark);border-radius:1px;color:var(--navy);outline:none;background:var(--cream);">
              <span :class="'status-badge status-'+(lstActiveProp.status||'draft')">{{ lstActiveProp.status || 'draft' }}</span>
            </div>
            <!-- Meta -->
            <div class="prop-detail-meta">{{ lstActiveProp.agent_name || agentName }} · {{ lstActiveProp.market || 'DC' }} · Created {{ new Date(lstActiveProp.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) }}</div>
            <!-- Completion bar -->
            <div class="prop-completion-row">
              <span class="prop-completion-label">Asset Completion</span>
              <div class="progress-bar-track"><div class="progress-bar-fill" :style="{width:(lstAssetCount/5*100)+'%'}"></div></div>
              <span class="prop-completion-pct">{{ lstAssetCount }}/5 folders</span>
            </div>
          </div>"""
assert old2 in html, "property header not found"
html = html.replace(old2, new2, 1)

# ═══════════════════════════════════════════════════════════════════════════════
# 3. FIX MLS TOOL "Edit ✎" — scroll to top so the edit form is visible
# ═══════════════════════════════════════════════════════════════════════════════
old3 = '''                        <button @click="lstEditingAddress=true;lstEditAddressVal=lstActiveProp.address" style="background:none;border:none;font-family:'Montserrat',sans-serif;font-size:7px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold-muted);cursor:pointer;white-space:nowrap;padding:0;">Edit ✎</button>'''
new3 = '''                        <button @click="lstEditingAddress=true;lstEditAddressVal=lstActiveProp.address;window.scrollTo({top:0,behavior:'smooth'})" style="background:none;border:none;font-family:'Montserrat',sans-serif;font-size:7px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold-muted);cursor:pointer;white-space:nowrap;padding:0;">Edit ✎</button>'''
assert old3 in html, f"MLS edit button not found"
html = html.replace(old3, new3, 1)

with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(html)

print("All three fixes applied.")
