with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    html = f.read()

# ── 1. ADD CSS for file-row system + btn-sm/btn-del ──────────────────────────
old_css = '.subfolder-body { padding: 16px 20px 18px; background: var(--cream); border-top: 1px solid var(--cream-mid); }'
new_css = '''.subfolder-body { padding: 16px 20px 18px; background: var(--cream); border-top: 1px solid var(--cream-mid); }

/* ── FILE ROW (swipe-to-delete) ── */
.file-row-wrap { position: relative; overflow: hidden; border-radius: 2px; margin-bottom: 4px; }
.file-row-del-reveal {
  position: absolute; right: 0; top: 0; bottom: 0; width: 72px;
  background: var(--navy); color: var(--gold);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; cursor: pointer; z-index: 1; transition: background 0.15s;
}
.file-row-del-reveal:active { background: #8c1818; color: #fff; }
.file-row-del-reveal .del-icon { font-size: 13px; line-height: 1; font-family: sans-serif; font-weight: 300; }
.file-row-del-reveal .del-label { font-family: \'Montserrat\', sans-serif; font-size: 6.5px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; }
.file-row {
  position: relative; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: var(--white); border: 1px solid var(--cream-mid); border-radius: 2px;
  transition: transform 0.22s ease;
}
.file-row.swiped { transform: translateX(-72px); }
.file-icon { font-size: 16px; flex-shrink: 0; }
.file-info { flex: 1; min-width: 0; }
.file-name { font-family: \'Cormorant Garamond\', \'Playfair Display\', serif; font-size: 13px; color: var(--navy); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-meta { font-family: \'Montserrat\', sans-serif; font-size: 9px; color: var(--ghost); letter-spacing: 0.06em; margin-top: 2px; }

/* ── SMALL BUTTONS ── */
.btn-sm { display: inline-flex; align-items: center; justify-content: center; font-family: \'Montserrat\', sans-serif; font-size: 8px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; padding: 5px 12px; border-radius: 1px; cursor: pointer; border: 1px solid transparent; transition: all 0.13s; background: none; color: var(--navy); }
.btn-del { width: 24px; height: 24px; padding: 0 !important; border-radius: 50% !important; font-size: 12px !important; letter-spacing: 0 !important; border: 1px solid var(--cream-dark) !important; color: var(--navy) !important; opacity: 0.5; background: none !important; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; font-family: sans-serif !important; }
.btn-del:hover { opacity: 1; color: #b91c1c !important; border-color: #fca5a5 !important; background: #fff0f0 !important; }'''

assert old_css in html, "subfolder-body CSS not found"
html = html.replace(old_css, new_css, 1)

# ── 2. Fix the 🗑 Delete reveal text ─────────────────────────────────────────
old_reveal = '<div class="file-row-del-reveal" @click="lstDeleteFile(file); fileSwipedId=null">🗑 Delete</div>'
new_reveal = '<div class="file-row-del-reveal" @click="lstDeleteFile(file); fileSwipedId=null"><span class="del-icon">✕</span><span class="del-label">Delete</span></div>'
assert old_reveal in html, "del-reveal div not found"
html = html.replace(old_reveal, new_reveal, 1)

# ── 3. Listing Remarks saved files delete button (line ~3995) ─────────────────
old_lr_del = '<button @click="lstDeleteFile(file)" style="background:none;border:none;cursor:pointer;color:var(--navy);opacity:0.3;font-size:13px;padding:2px 4px;flex-shrink:0;line-height:1;" title="Delete">✕</button>'
new_lr_del = '<button @click="lstDeleteFile(file)" class="btn-del" title="Delete">✕</button>'
assert old_lr_del in html, "listing_remarks del button not found"
html = html.replace(old_lr_del, new_lr_del, 1)

# ── 4. Buyer files delete button (line ~2438) ─────────────────────────────────
old_byr_del = '<button @click="byrDeleteFile(f)" style="background:none;border:none;color:#e74c3c;cursor:pointer;font-size:11px;padding:0 2px;" title="Delete">✕</button>'
new_byr_del = '<button @click="byrDeleteFile(f)" class="btn-del" title="Delete">✕</button>'
assert old_byr_del in html, "buyer del button not found"
html = html.replace(old_byr_del, new_byr_del, 1)

# ── 5. Inline property bar delete button (dark background, line ~3723) ────────
old_bar_del = '<button @click="lstDeleteFile(file)" title="Delete" style="width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.6);font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s;" @mouseenter="$event.currentTarget.style.background=\'rgba(220,38,38,0.35)\';$event.currentTarget.style.color=\'#fca5a5\'" @mouseleave="$event.currentTarget.style.background=\'rgba(255,255,255,0.1)\';$event.currentTarget.style.color=\'rgba(255,255,255,0.6)\'">✕</button>'
new_bar_del = '<button @click="lstDeleteFile(file)" title="Delete" style="width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.65);font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s;font-family:sans-serif;" onmouseover="this.style.background=\'rgba(180,30,30,0.5)\';this.style.borderColor=\'rgba(255,150,150,0.4)\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'rgba(255,255,255,0.08)\';this.style.borderColor=\'rgba(255,255,255,0.2)\';this.style.color=\'rgba(255,255,255,0.65)\'">✕</button>'
assert old_bar_del in html, "property bar del button not found"
html = html.replace(old_bar_del, new_bar_del, 1)

# ── 6. Client files card delete buttons (btn-sm btn-del with inline position) ─
# These use btn-del class which now has CSS — just strip the redundant inline style
old_cf1 = '<button v-if="adminViewAgent === agentName" class="btn-sm btn-del" @click.stop="removePropFile(pf.id)" style="position:absolute;top:10px;right:10px;font-size:11px;">✕</button>'
new_cf1 = '<button v-if="adminViewAgent === agentName" class="btn-del" @click.stop="removePropFile(pf.id)" style="position:absolute;top:8px;right:8px;" title="Delete">✕</button>'
assert old_cf1 in html, "client file del btn 1 not found"
html = html.replace(old_cf1, new_cf1, 1)

old_cf2 = '<button class="btn-sm btn-del" @click.stop="removePropFile(pf.id)" style="position:absolute;top:10px;right:10px;font-size:11px;">✕</button>'
new_cf2 = '<button class="btn-del" @click.stop="removePropFile(pf.id)" style="position:absolute;top:8px;right:8px;" title="Delete">✕</button>'
assert old_cf2 in html, "client file del btn 2 not found"
html = html.replace(old_cf2, new_cf2, 1)

old_cr1 = '<button v-if="!activePropFile._viewingAgent || activePropFile._viewingAgent === agentName" class="btn-sm btn-del" @click="removeResource(activePropFile.id, r.id)">✕</button>'
new_cr1 = '<button v-if="!activePropFile._viewingAgent || activePropFile._viewingAgent === agentName" class="btn-del" @click="removeResource(activePropFile.id, r.id)" title="Delete">✕</button>'
assert old_cr1 in html, "client resource del btn 1 not found"
html = html.replace(old_cr1, new_cr1, 1)

old_cr2 = '<button class="btn-sm btn-del" @click="removeResource(activePropFile.id, r.id)">✕</button>'
new_cr2 = '<button class="btn-del" @click="removeResource(activePropFile.id, r.id)" title="Delete">✕</button>'
assert old_cr2 in html, "client resource del btn 2 not found"
html = html.replace(old_cr2, new_cr2, 1)

# ── 7. Tour card delete buttons ────────────────────────────────────────────────
old_tt1 = '<button class="btn-sm btn-del" @click.stop="ttDeleteTour(tour.id)" style="position:absolute;top:10px;right:10px;font-size:11px;">✕</button>'
new_tt1 = '<button class="btn-del" @click.stop="ttDeleteTour(tour.id)" style="position:absolute;top:8px;right:8px;" title="Delete">✕</button>'
assert old_tt1 in html, "tour del btn not found"
html = html.replace(old_tt1, new_tt1, 1)

old_tt2 = '<button class="btn-sm btn-del" @click.stop="ttRemoveProperty(prop.id)" style="position:absolute;top:10px;right:10px;font-size:11px;">✕</button>'
new_tt2 = '<button class="btn-del" @click.stop="ttRemoveProperty(prop.id)" style="position:absolute;top:8px;right:8px;" title="Delete">✕</button>'
assert old_tt2 in html, "tour property del btn not found"
html = html.replace(old_tt2, new_tt2, 1)

# ── 8. Library delete button ───────────────────────────────────────────────────
old_lib = '<button class="btn-sm btn-del" @click="delItem(item.id)">✕</button>'
new_lib = '<button class="btn-del" @click="delItem(item.id)" title="Delete">✕</button>'
assert old_lib in html, "library del btn not found"
html = html.replace(old_lib, new_lib, 1)

with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(html)

print("All delete styles updated successfully.")
