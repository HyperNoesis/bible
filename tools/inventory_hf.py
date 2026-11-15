"""Print licence + large files of a Hugging Face model repo (used by .github/workflows/inventory-models.yml). Usage: python inventory_hf.py owner/name"""
import json, sys, urllib.request

repo = sys.argv[1]
try:
    with urllib.request.urlopen("https://huggingface.co/api/models/%s?blobs=true" % repo, timeout=60) as r:
        d = json.load(r)
except Exception as e:
    print("  (not available: %s)" % e)
    sys.exit(0)
card = d.get("cardData") or {}
print("  license: %s | gated: %s" % (card.get("license"), d.get("gated")))
for s in d.get("siblings", []):
    n, sz = s["rfilename"], s.get("size") or 0
    if sz > 200000 or n.lower().endswith((".md", ".txt")):
        print("  %8.1f MB  %s" % (sz / 1048576, n))
