with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    content = f.read()

old = "        try{ res=await fetch(CC_RAILWAY_URL+'/api/buyer-report/deploy',{\n          method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},\n          body:JSON.stringify({analysis:bmrAnalysis.value,offer_price:bmrOfferPrice.value,offer_terms:bmrOfferTerms.value,client_name:bmrClientName.value,agent_name:aName,agent_email:AGENT_EMAILS[aName]||'',agent_phone:AGENT_PHONES[aName]||'',report_title:bmrReportTitle.value,market_conditions:bmrMarketConditions.value,subject_dom:parseInt(bmrSubjectDom.value)||0}),\n          signal:ctrl2.signal}); }"

print(repr(old[:80]))
print("Found:", old in content)
# Show actual surrounding text
idx = content.find("api/buyer-report/deploy")
print(repr(content[idx-10:idx+400]))
