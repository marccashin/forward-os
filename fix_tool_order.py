with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'r') as f:
    content = f.read()

def extract(start_marker, end_marker):
    start = content.find(start_marker)
    end = content.find(end_marker, start)
    assert start != -1, f"Start not found: {start_marker!r}"
    assert end != -1, f"End not found: {end_marker!r}"
    return content[start:end]

pre_header   = extract('<!-- PRE-LISTING category -->',        '<!-- Tool: Listing Presentation -->')
listing_pres = extract('<!-- Tool: Listing Presentation -->',  '<!-- Tool: Seller Net Sheet -->')
net_sheet    = extract('<!-- Tool: Seller Net Sheet -->',      '<!-- ACTIVE LISTING category -->')
act_header   = extract('<!-- ACTIVE LISTING category -->',     '<!-- Tool: Listing Description -->')
listing_desc = extract('<!-- Tool: Listing Description -->',   '<!-- Tool: CMA Snapshot -->')
cma          = extract('<!-- Tool: CMA Snapshot -->',          '<!-- Tool: Market Report -->')
market_rep   = extract('<!-- Tool: Market Report -->',         '<!-- Tool: Price Reduction Planner -->')
price_red    = extract('<!-- Tool: Price Reduction Planner -->', '<!-- Tool: Seller Prep Guide -->')

# Seller prep: end at the closing </div> pair after it
seller_prep_start = content.find('<!-- Tool: Seller Prep Guide -->')
# Find the two blank lines + closing </div> that ends the tools list
end_marker = '\n\n\n            </div>'
seller_prep_end = content.find(end_marker, seller_prep_start)
assert seller_prep_end != -1, "Seller Prep end not found"
seller_prep = content[seller_prep_start:seller_prep_end]

# Build the old block (everything from PRE-LISTING header through end of seller prep)
old_block_start = content.find('<!-- PRE-LISTING category -->')
old_block = content[old_block_start:seller_prep_end]

# Build the new block in correct order:
# PRE-LISTING: Listing Presentation → CMA Snapshot → Seller Prep Guide
# ACTIVE LISTING: Listing Description → Seller Net Sheet → Price Reduction Planner
# (Market Report ungrouped after)
new_block = (
    pre_header +
    listing_pres +
    cma +
    '\n' +
    seller_prep +
    '\n\n' +
    act_header +
    listing_desc +
    net_sheet +
    '\n' +
    price_red +
    '\n\n' +
    market_rep
)

assert old_block in content, "Old block not found in content"
new_content = content.replace(old_block, new_block, 1)
assert new_content != content, "No change made"

with open('/sessions/charming-lucid-gauss/forward-os/index.html', 'w') as f:
    f.write(new_content)

print("Done. Verifying new order...")

# Verify order
positions = {
    'PRE-LISTING header':   new_content.find('<!-- PRE-LISTING category -->'),
    'Listing Presentation': new_content.find('<!-- Tool: Listing Presentation -->'),
    'CMA Snapshot':         new_content.find('<!-- Tool: CMA Snapshot -->'),
    'Seller Prep Guide':    new_content.find('<!-- Tool: Seller Prep Guide -->'),
    'ACTIVE LISTING header':new_content.find('<!-- ACTIVE LISTING category -->'),
    'Listing Description':  new_content.find('<!-- Tool: Listing Description -->'),
    'Seller Net Sheet':     new_content.find('<!-- Tool: Seller Net Sheet -->'),
    'Price Reduction':      new_content.find('<!-- Tool: Price Reduction Planner -->'),
    'Market Report':        new_content.find('<!-- Tool: Market Report -->'),
}
for name, pos in positions.items():
    print(f"  {pos:6d}  {name}")
