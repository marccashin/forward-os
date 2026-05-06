with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    content = f.read()

original = content

# ── 1. Fix letter spacing + greeting logic ───────────────────────
old_letter = """  // ── Page 2: Letter to Seller ─────────────────────────────────
  addPage();
  sectionHeader('Letter to Seller');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);

  const greeting = firstName ? ('Dear ' + firstName + ',') : 'Dear Valued Client,';
  doc.text(dateStr, ML, y); y += 18;
  doc.text(greeting, ML, y); y += 18;

  const letterBody = [
    'It has been a privilege preparing this campaign package for ' + addr + '. What follows is a comprehensive, multi-channel marketing strategy built specifically around your property, its history, its infrastructure, and the buyers who will recognize its true value.',
    'Every element of this package has been designed to attract serious, qualified buyers: the buyer profiles identify exactly who is looking for a property like yours and what motivates them to act; the listing description positions your home at the highest level of the market; and the social media, video, and advertising materials are ready to deploy across every relevant platform.',
    'The 30-day campaign plan gives you full visibility into every step, from the pre-market teaser and broker open through the sustained digital campaign and private showing events. Nothing is left to chance.',
    'I am committed to representing this property with the same level of care and precision that has gone into every detail of the home itself. Please reach out with any questions as we move toward launch.',
  ];

  letterBody.forEach(function(para) {
    const wrapped = doc.splitTextToSize(para, TW);
    wrapped.forEach(function(line) { checkY(14); doc.text(line, ML, y); y += 14; });
    y += 8;
  });

  doc.text('Warm regards,', ML, y); y += 16;
  doc.setFont('helvetica', 'bold');
  doc.text(agentDisplay, ML, y); y += 14;
  doc.setFont('helvetica', 'normal');
  doc.text('FORWARD | Corcoran McEnearney', ML, y); y += 24;"""

new_letter = """  // ── Page 2: Letter to Seller ─────────────────────────────────
  addPage();
  sectionHeader('Letter to Seller');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);

  // Build greeting — skip entirely if no seller name on file
  const sellerName2 = clean(prop.seller_name_2 || '');
  const firstName2 = sellerName2 ? sellerName2.split(' ')[0] : '';
  let greeting = '';
  if (firstName && firstName2) {
    greeting = 'Dear ' + firstName + ' and ' + firstName2 + ',';
  } else if (firstName) {
    greeting = 'Dear ' + firstName + ',';
  }

  y += 36; // breathing room after section header
  doc.text(dateStr, ML, y); y += 28;
  if (greeting) { doc.text(greeting, ML, y); y += 28; }

  const letterBody = [
    'It has been a privilege preparing this campaign package for ' + addr + '. What follows is a comprehensive, multi-channel marketing strategy built specifically around your property, its history, its infrastructure, and the buyers who will recognize its true value.',
    'Every element of this package has been designed to attract serious, qualified buyers: the buyer profiles identify exactly who is looking for a property like yours and what motivates them to act; the listing description positions your home at the highest level of the market; and the social media, video, and advertising materials are ready to deploy across every relevant platform.',
    'The 30-day campaign plan gives you full visibility into every step, from the pre-market teaser and broker open through the sustained digital campaign and private showing events. Nothing is left to chance.',
    'I am committed to representing this property with the same level of care and precision that has gone into every detail of the home itself. Please reach out with any questions as we move toward launch.',
  ];

  doc.setFontSize(11);
  letterBody.forEach(function(para) {
    const wrapped = doc.splitTextToSize(para, TW);
    wrapped.forEach(function(line) { checkY(16); doc.text(line, ML, y); y += 16; });
    y += 14;
  });

  y += 8;
  doc.text('Warm regards,', ML, y); y += 22;
  doc.setFont('helvetica', 'bold');
  doc.text(agentDisplay, ML, y); y += 18;
  doc.setFont('helvetica', 'normal');
  doc.text('FORWARD | Corcoran McEnearney', ML, y); y += 30;"""

assert old_letter in content, "Letter block not found"
content = content.replace(old_letter, new_letter, 1)
print("1. Letter fixed")

# ── 2. Add lstNewSeller2 ref ─────────────────────────────────────
old_refs = "    const lstNewSeller  = ref('');"
new_refs  = "    const lstNewSeller  = ref('');\n    const lstNewSeller2 = ref('');"
assert old_refs in content, "lstNewSeller ref not found"
content = content.replace(old_refs, new_refs, 1)
print("2. lstNewSeller2 ref added")

# ── 3. Add co-seller to Supabase insert ──────────────────────────
old_insert = "          seller_name: lstNewSeller.value.trim(),"
new_insert  = "          seller_name: lstNewSeller.value.trim(),\n              seller_name_2: lstNewSeller2.value.trim() || null,"
assert old_insert in content, "Supabase insert not found"
content = content.replace(old_insert, new_insert, 1)
print("3. Supabase insert updated")

# ── 4. Reset lstNewSeller2 on modal close ────────────────────────
old_reset = "        lstNewSeller.value = ''; lstNewMarket.value = 'DC';"
new_reset  = "        lstNewSeller.value = ''; lstNewSeller2.value = ''; lstNewMarket.value = 'DC';"
assert old_reset in content, "Reset line not found"
content = content.replace(old_reset, new_reset, 1)
print("4. Reset updated")

# ── 5. Replace Seller Name field with two-column Seller/Co-Seller ─
old_seller_field = "        <!-- Seller name -->\n        <div class=\"form-row\" style=\"margin-bottom:20px;\">\n          <label>Seller Name</label>\n          <input v-model=\"lstNewSeller\" placeholder=\"e.g. John & Jane Smith\" style=\"width:100%;box-sizing:border-box;\" @keyup.enter=\"lstCreateProperty\">\n        </div>"

new_seller_field = """        <!-- Seller name(s) -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
          <div class="form-row">
            <label>Seller Name</label>
            <input v-model="lstNewSeller" placeholder="First Last" style="width:100%;box-sizing:border-box;" @keyup.enter="lstCreateProperty">
          </div>
          <div class="form-row">
            <label>Co-Seller <span style="font-weight:400;opacity:0.5;font-size:9px;">(optional)</span></label>
            <input v-model="lstNewSeller2" placeholder="First Last" style="width:100%;box-sizing:border-box;" @keyup.enter="lstCreateProperty">
          </div>
        </div>"""

assert old_seller_field in content, f"Seller field not found. Snippet around it: {content[content.find('Seller name'):content.find('Seller name')+200]!r}"
content = content.replace(old_seller_field, new_seller_field, 1)
print("5. Seller/Co-Seller fields updated")

# ── 6. Expose lstNewSeller2 in return ────────────────────────────
old_return = "lstShowNewModal, lstNewAddress, lstNewStreet, lstNewUnit, lstNewCity, lstNewState, lstNewZip, lstNewSeller, lstNewMarket,"
new_return  = "lstShowNewModal, lstNewAddress, lstNewStreet, lstNewUnit, lstNewCity, lstNewState, lstNewZip, lstNewSeller, lstNewSeller2, lstNewMarket,"
assert old_return in content, "Return statement not found"
content = content.replace(old_return, new_return, 1)
print("6. Return updated")

assert content != original, "No changes made"
with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(content)
print("Done — all 6 changes applied")
