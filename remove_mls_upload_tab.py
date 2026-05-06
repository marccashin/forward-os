with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    html = f.read()

# 1. Update the comment
old1 = '<!-- Tool: MLS Data (tabbed: Upload or Manual Form) -->'
new1 = '<!-- Tool: MLS Data (Manual Form) -->'
assert old1 in html, "Comment not found"
html = html.replace(old1, new1, 1)

# 2. Remove tab switcher div
old2 = '''                  <!-- Tab switcher -->
                  <div style="display:flex;gap:0;border-radius:8px;overflow:hidden;border:1.5px solid var(--navy);margin-bottom:14px;">
                    <button @click="mlsTab=\'upload\'" :style="{flex:1,padding:\'8px 0\',fontSize:\'12px\',fontWeight:600,border:\'none\',cursor:\'pointer\',background:mlsTab===\'upload\'?\'var(--navy)\':\'#fff\',color:mlsTab===\'upload\'?\'#fff\':\'var(--navy)\',transition:\'all .15s\'}">Upload MLS Sheet</button>
                    <button @click="mlsTab=\'manual\'" :style="{flex:1,padding:\'8px 0\',fontSize:\'12px\',fontWeight:600,border:\'none\',cursor:\'pointer\',borderLeft:\'1.5px solid var(--navy)\',background:mlsTab===\'manual\'?\'var(--navy)\':\'#fff\',color:mlsTab===\'manual\'?\'#fff\':\'var(--navy)\',transition:\'all .15s\'}">Enter Manually</button>
                  </div>

                  <!-- Tab A: Upload -->
                  <div v-if="mlsTab===\'upload\'">
                    <div v-if="lstUploading[\'mls_data\']" style="margin-bottom:14px;"><div style="font-size:12px;color:var(--navy);margin-bottom:4px;">Uploading...</div><div class="progress-bar-track"><div class="progress-bar-fill" style="width:60%;"></div></div></div>
                    <div v-if="lstActiveProp.status!==\'running\'&&lstActiveProp.status!==\'submitted\'" class="drop-zone" :class="{\'drag-over\':lstDragOver===\'mls_data\'}" @dragover.prevent="lstDragOver=\'mls_data\'" @dragleave="lstDragOver=\'\'" @drop.prevent="lstHandleDrop($event,\'mls_data\')" @click="$refs.mlsFileInput?.click()">
                      <input ref="mlsFileInput" type="file" accept=".pdf,.xlsx,.csv,.doc,.docx" multiple style="display:none;" @change="lstHandleFileInput($event,\'mls_data\')">
                      <div class="drop-zone-text"><span style="font-size:20px;">📁</span><br>Upload MLS data files<br><span style="font-size:11px;">.pdf, .xlsx, .csv, .doc</span></div>
                    </div>
                  </div>

                  <!-- Tab B: Manual Form -->
                  <div v-if="mlsTab===\'manual\'">'''
new2 = '                  <!-- Manual Form -->\n                  <div>'

assert old2 in html, "Tab switcher + Upload tab block not found"
html = html.replace(old2, new2, 1)

# 3. Remove mlsTab ref from JS
old3 = "    const mlsTab    = ref('upload');\n"
new3 = ""
assert old3 in html, "mlsTab ref not found"
html = html.replace(old3, new3, 1)

# 4. Remove mlsTab from setup() return
old4 = "      mlsTab, mlsForm, mlsSaving, mlsGate, mlsSaveManual, mlsFormatPrice, mlsFormatSqft, lstOpenTool,"
new4 = "      mlsForm, mlsSaving, mlsGate, mlsSaveManual, mlsFormatPrice, mlsFormatSqft, lstOpenTool,"
assert old4 in html, "mlsTab in return not found"
html = html.replace(old4, new4, 1)

with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(html)

print("Done. Changes applied successfully.")
