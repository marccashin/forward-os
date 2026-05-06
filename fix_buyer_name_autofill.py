with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    content = f.read()

old = '                    <input type="text" :value="byrActiveBuyer.first_name||\'\'" @blur="byrUpdateProfile(\'first_name\',$event.target.value||null)" placeholder="e.g. Sarah" style="font-size:13px;padding:8px 10px;">'
new = '                    <input type="text" :value="byrActiveBuyer.first_name||(byrActiveBuyer.buyer_name?byrActiveBuyer.buyer_name.trim().split(\' \')[0]:\'\')" @blur="byrUpdateProfile(\'first_name\',$event.target.value||null)" placeholder="e.g. Sarah" style="font-size:13px;padding:8px 10px;">'

assert old in content, "First name input not found"
content = content.replace(old, new, 1)
print("1. First name fallback added")

old2 = '                    <input type="text" :value="byrActiveBuyer.last_name||\'\'" @blur="byrUpdateProfile(\'last_name\',$event.target.value||null)" placeholder="e.g. Thompson" style="font-size:13px;padding:8px 10px;">'
new2 = '                    <input type="text" :value="byrActiveBuyer.last_name||(byrActiveBuyer.buyer_name?byrActiveBuyer.buyer_name.trim().split(\' \').slice(1).join(\' \'):\'\')" @blur="byrUpdateProfile(\'last_name\',$event.target.value||null)" placeholder="e.g. Thompson" style="font-size:13px;padding:8px 10px;">'

assert old2 in content, "Last name input not found"
content = content.replace(old2, new2, 1)
print("2. Last name fallback added")

with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(content)
print("Done")
